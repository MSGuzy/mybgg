// Configuration loaded from HTML data attributes
const CONFIG = (() => {
  return {
    GAMES_PER_PAGE: 48,
    COMPLEXITY_THRESHOLDS: [1.5, 2.5, 3.5, 4.5],
    COMPLEXITY_NAMES: ['Light', 'Light Medium', 'Medium', 'Medium Heavy', 'Heavy'],
    PLAYING_TIMES: ['< 30min', '30min - 1h', '1-2h', '2-3h', '3-4h', '> 4h'],
    SORT_OPTIONS: [
      { value: 'name', text: 'Name', defaultDir: 'asc' },
      { value: 'rank', text: 'BGG Rank', defaultDir: 'asc' },
      { value: 'my_rating', text: 'My Rating', defaultDir: 'desc' },
      { value: 'weight', text: 'Weight', defaultDir: 'asc' },
      { value: 'playing_time', text: 'Playing Time', defaultDir: 'asc' }
    ]
  };
})();

// Legacy constants for compatibility
let GAMES_PER_PAGE = CONFIG.GAMES_PER_PAGE;

// Global state
let db = null;
let allGames = [];
let filteredGames = [];
let currentPage = 1;

// Utility functions
function showError(message) {
  const container = document.getElementById('hits');
  const template = document.getElementById('error-template');
  const clone = template.content.cloneNode(true);
  clone.querySelector('.error-message').textContent = message;
  container.innerHTML = '';
  container.appendChild(clone);
}

function createElement(tag, attributes = {}, textContent = '') {
  const element = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'className') {
      element.className = value;
    } else {
      element.setAttribute(key, value);
    }
  });
  if (textContent) element.textContent = textContent;
  return element;
}

function createTagChipsContainer(chips) {
  if (!chips || chips.length === 0) return '';
  const template = document.getElementById('tag-chips-container-template');
  const clone = template.content.cloneNode(true);
  const container = clone.querySelector('.tag-chips');
  container.innerHTML = chips;
  return container.outerHTML;
}

// Core application functions
function loadINI(path, callback) {
  fetch(path)
    .then(response => response.text())
    .then(text => {
      const config = {};
      const lines = text.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and comments
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Parse key = value pairs
        const equalIndex = trimmed.indexOf('=');
        if (equalIndex > 0) {
          const key = trimmed.substring(0, equalIndex).trim();
          let value = trimmed.substring(equalIndex + 1).trim();

          // Remove quotes if present
          if ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
          }

          config[key] = value;
        }
      }

      // Transform flat config into nested structure expected by the app
      const settings = {
        title: config.title || "GameCache",
        games_per_page: config.games_per_page,
        bgg: {
          username: config.bgg_username
        },
        github: {
          repo: config.github_repo,
        }
      };

      callback(settings);
    })
    .catch(error => console.error('Error loading config:', error));
}

async function initializeDatabase(settings) {
  try {
    const SQL = await initSqlJs({
      locateFile: file => `https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/${file}`
    });

    const isDev = /^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);
    // Use existing CORS proxy host
    const dbUrl = isDev ? './gamecache.sqlite.gz' :
      `https://cors-proxy.mybgg.workers.dev/${settings.github.repo}`;

    console.log(`Loading database from: ${dbUrl}`);

    let response = await fetch(dbUrl);
    if (!response.ok && isDev) {
      // In development, fall back to the legacy local artifact name
      const legacyDbUrl = './mybgg.sqlite.gz';
      console.warn(`Primary database URL failed (${dbUrl}), trying legacy local file: ${legacyDbUrl}`);
      response = await fetch(legacyDbUrl);
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch database: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const dbData = fflate.gunzipSync(bytes);

    db = new SQL.Database(dbData);
    console.log('Database loaded successfully');

    loadAllGames();
    initializeUI();

  } catch (error) {
    console.error('Error initializing database:', error);

    let userMessage = 'Failed to load your board game database. ';

    if (error.message.includes('404') || error.message.includes('Failed to fetch')) {
      userMessage += 'This usually means:\n\n' +
        '• You haven\'t run the setup script yet (python scripts/download_and_index.py --cache_bgg)\n' +
        '• The database upload failed\n' +
        '• GitHub Pages isn\'t enabled or is still setting up (can take 10-15 minutes)\n\n' +
        'Try running the script again, and make sure GitHub Pages is enabled in your repository settings.';
    } else if (error.message.includes('gzip')) {
      userMessage += 'The database file appears to be corrupted. Try running the setup script again.';
    } else {
      userMessage += `Technical error: ${error.message}`;
    }

    showError(userMessage);
  }
}

function parsePlayerCount(countStr) {
  if (!countStr) return { min: 0, max: 0, open: false };
  let s = String(countStr).trim();

  if (s.endsWith('+')) {
    const numPart = s.slice(0, -1);
    const min = parseInt(numPart, 10);
    if (String(min) === numPart) {
      return { min: min, max: Infinity, open: true };
    }
  }

  const rangeMatch = s.match(/^(\d+)[–-](\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return { min: min, max: max, open: false };
  }

  const num = parseInt(s, 10);
  if (!isNaN(num)) {
    if (String(num) === s) {
      return { min: num, max: num, open: false };
    }
  }

  return { min: 0, max: 0, open: false };
}

function loadAllGames() {
  const stmt = db.prepare(`
    SELECT id, name, description, categories, mechanics, players, weight,
           playing_time, playing_time_minutes, min_age, rank, usersrated, numowned, rating,
           numplays, my_rating, image, tags, expansions, color
    FROM games
    ORDER BY name
  `);

  allGames = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();

    row.weight = parseFloat(row.weight);
    row.playing_time_minutes = parseFloat(row.playing_time_minutes);
    row.my_rating = parseFloat(row.my_rating);

    try {
      row.categories = JSON.parse(row.categories || '[]');
      row.mechanics = JSON.parse(row.mechanics || '[]');
      row.players = JSON.parse(row.players || '[]');
      row.tags = JSON.parse(row.tags || '[]');
      row.expansions = JSON.parse(row.expansions || '[]');
    } catch (e) {
      console.warn('Error parsing JSON for game:', row.id, e);
    }

    allGames.push(row);
  }
  stmt.free();

  filteredGames = [...allGames];
  console.log(`Loaded ${allGames.length} games.`);
}

function initializeUI() {
  setupSearchBox();
  setupFilters();
  setupSorting();

  const initialState = getFiltersFromURL();
  updateUIFromState(initialState);
  applyFiltersAndSort(initialState);
  updateResults();
  updateStats();

  window.addEventListener('popstate', (event) => {
    const state = event.state || getFiltersFromURL();
    updateUIFromState(state);
    applyFiltersAndSort(state);
    updateResults();
    updateStats();
  });
}

function setupSearchBox() {
  const searchBox = document.getElementById('search-box');

  const wrapper = createElement('div', { className: 'search-input-wrapper' });
  const icon = createElement('span', { className: 'material-symbols-rounded search-icon' }, 'search');
  const input = createElement('input', {
    type: 'text',
    id: 'search-input',
    placeholder: 'Search games...'
  });
  const clearBtn = createElement('button', { type: 'button', className: 'search-clear-btn' });
  clearBtn.appendChild(createElement('span', { className: 'material-symbols-rounded' }, 'close'));
  clearBtn.style.display = 'none';

  wrapper.appendChild(icon);
  wrapper.appendChild(input);
  wrapper.appendChild(clearBtn);
  searchBox.appendChild(wrapper);

  function updateClearVisibility() {
    clearBtn.style.display = input.value ? 'flex' : 'none';
  }

  input.addEventListener('input', updateClearVisibility);
  input.addEventListener('input', debounce(onFilterChange, 300));

  clearBtn.addEventListener('click', function () {
    input.value = '';
    updateClearVisibility();
    onFilterChange();
    input.focus();
  });
}

function getSortOption(value) {
  return CONFIG.SORT_OPTIONS.find(option => option.value === value) || CONFIG.SORT_OPTIONS[0];
}

function setSortDirButtonState(dir) {
  const dirBtn = document.getElementById('sort-dir-btn');
  if (!dirBtn) return;

  dirBtn.dataset.dir = dir;
  dirBtn.setAttribute('aria-pressed', dir === 'desc' ? 'true' : 'false');
  dirBtn.setAttribute('aria-label', dir === 'asc' ? 'Sort ascending' : 'Sort descending');
}

function getSortDirButtonState() {
  const dirBtn = document.getElementById('sort-dir-btn');
  return (dirBtn && dirBtn.dataset.dir) || 'asc';
}

function setupSorting() {
  const sortContainer = document.getElementById('sort-by');
  const select = createElement('select', {
    id: 'sort-select',
    name: 'sort-by'
  });

  CONFIG.SORT_OPTIONS.forEach(({ value, text }) => {
    const option = createElement('option', { value }, text);
    select.appendChild(option);
  });

  sortContainer.appendChild(select);

  const dirBtn = createElement('button', {
    type: 'button',
    id: 'sort-dir-btn',
    className: 'sort-dir-btn'
  });
  dirBtn.appendChild(createElement('span', { className: 'material-symbols-rounded' }, 'swap_vert'));
  sortContainer.parentElement.appendChild(dirBtn);
  setSortDirButtonState('asc');

  select.addEventListener('change', function () {
    setSortDirButtonState(getSortOption(select.value).defaultDir);
    onFilterChange();
  });

  dirBtn.addEventListener('click', function () {
    const nextDir = getSortDirButtonState() === 'asc' ? 'desc' : 'asc';
    setSortDirButtonState(nextDir);
    onFilterChange();
  });
}

function setupFilters() {
  setupCategoriesFilter();
  setupMechanicsFilter();
  setupPlayersFilter();
  setupWeightFilter();
  setupPlayingTimeFilter();
  setupClearAllButton();

  // Ensure player sub-options are hidden initially
  hideAllPlayerSubOptions();

  // Ensure "Any" is checked by default for players filter
  ensurePlayerAnyIsSelected();
}

function hideAllPlayerSubOptions() {
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');
  allPlayerLabels.forEach(label => {
    const level = parseInt(label.dataset.level, 10);
    if (level > 0) {
      label.style.display = 'none';
    }
  });
}

function ensurePlayerAnyIsSelected() {
  const playersContainer = document.getElementById('facet-players');
  if (!playersContainer) return;

  const anyInput = playersContainer.querySelector('input[value="any"]');
  if (anyInput && !anyInput.checked) {
    anyInput.checked = true;
  }

  // Make sure all sub-options are hidden when "Any" is selected
  hideAllPlayerSubOptions();
}

function setupCategoriesFilter() {
  const categoryCounts = {};
  allGames.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });

  const sortedCategories = Object.keys(categoryCounts).sort();
  const items = sortedCategories.map(cat => ({
    label: cat,
    value: cat,
    count: categoryCounts[cat]
  }));

  // Only create the filter if there are categories
  if (items.length > 0) {
    createRefinementFilter('facet-categories', 'Categories', items, 'categories', false, true);
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-categories');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupMechanicsFilter() {
  const mechanicCounts = {};
  allGames.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });

  const sortedMechanics = Object.keys(mechanicCounts).sort();
  const items = sortedMechanics.map(mech => ({
    label: mech,
    value: mech,
    count: mechanicCounts[mech]
  }));

  // Only create the filter if there are mechanics
  if (items.length > 0) {
    createRefinementFilter('facet-mechanics', 'Mechanics', items, 'mechanics', false, true);
  } else {
    // Hide the filter container if no items
    const container = document.getElementById('facet-mechanics');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayersFilter() {
  const playerCounts = new Set();
  allGames.forEach(game => {
    game.players.forEach(([count, type]) => {
      if (type === 'not recommended') return;

      const { min, max } = parsePlayerCount(count);
      if (min > 0) {
        const upper = isFinite(max) ? max : min;
        for (let i = min; i <= upper; i++) {
          playerCounts.add(i);
        }
      }
    });
  });

  const sortedPlayers = Array.from(playerCounts).filter(p => p <= 12).sort((a, b) => a - b);

  const playerItems = [{
    label: 'Any',
    value: 'any',
    default: true,
    count: allGames.length,
    level: 0
  }];

  // Add main player count options and their sub-options
  sortedPlayers.forEach(p => {
    const mainCount = allGames.filter(game => {
      return game.players.some(([playerCount, type]) => {
        if (type === 'not recommended') return false;
        const { min, max } = parsePlayerCount(playerCount);
        return p >= min && p <= max;
      });
    }).length;

    // Main player count option
    playerItems.push({
      label: `${p} player${p === 1 ? '' : 's'}`,
      value: p.toString(),
      count: mainCount,
      level: 0
    });

    // Sub-options for different recommendation types
    const recommendationTypes = ['best', 'recommended', 'expansion'];
    recommendationTypes.forEach(recType => {
      const typeCount = allGames.filter(game => {
        return game.players.some(([playerCount, type]) => {
          if (type !== recType) return false;
          const { min, max } = parsePlayerCount(playerCount);
          return p >= min && p <= max;
        });
      }).length;

      if (typeCount > 0) {
        const typeLabel = recType === 'best' ? 'Best with' :
                         recType === 'recommended' ? 'Recommended with' :
                         'Expansions allow';

        playerItems.push({
          label: `${typeLabel} ${p} player${p === 1 ? '' : 's'}`,
          value: `${p}-${recType}`,
          count: typeCount,
          level: 1,
          parentValue: p.toString()
        });
      }
    });
  });

  createRefinementFilter('facet-players', 'Players', playerItems, 'players', true);
}

function setupWeightFilter() {
  const weightCounts = {};
  allGames.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });

  const items = CONFIG.COMPLEXITY_NAMES.map(name => ({
    label: name,
    value: name,
    count: weightCounts[name] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-weight', 'Weight', items, 'weight');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-weight');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function setupPlayingTimeFilter() {
  const timeCounts = {};
  allGames.forEach(game => {
    if (game.playing_time) {
      timeCounts[game.playing_time] = (timeCounts[game.playing_time] || 0) + 1;
    }
  });

  const items = CONFIG.PLAYING_TIMES.map(time => ({
    label: time,
    value: time,
    count: timeCounts[time] || 0
  }));

  // Check if all items have zero count (effectively empty filter)
  const hasAnyItems = items.some(item => item.count > 0);
  if (hasAnyItems) {
    createRefinementFilter('facet-playing-time', 'Time', items, 'playing_time');
  } else {
    // Hide the filter container if no items have counts
    const container = document.getElementById('facet-playing-time');
    if (container) {
      container.style.display = 'none';
    }
  }
}

function createRefinementFilter(facetId, title, items, attributeName, isRadio = false, searchable = false) {
  const container = document.getElementById(facetId);
  if (!container) return;

  // Create filter dropdown structure manually
  const template = document.getElementById('filter-item-template');
  const filterItemsHtml = items.map(item => {
    const value = (typeof item === 'object' && item.value !== undefined) ? item.value : (typeof item === 'object' && item.min !== undefined ? `${item.min}-${item.max}` : item);
    const label = (typeof item === 'object' && item.label !== undefined) ? item.label : item;
    const count = (typeof item === 'object' && item.count !== undefined) ? item.count : null;
    const checked = (isRadio && typeof item === 'object' && item.default) ? 'checked' : '';
    const inputType = isRadio ? 'radio' : 'checkbox';
    const level = (typeof item === 'object' && item.level !== undefined) ? item.level : 0;
    const parentValue = (typeof item === 'object' && item.parentValue !== undefined) ? item.parentValue : '';

    const clone = template.content.cloneNode(true);
    const labelEl = clone.querySelector('.filter-item');
    const input = clone.querySelector('input');
    const span = clone.querySelector('.filter-label');
    const countEl = clone.querySelector('.facet-count');

    input.type = inputType;
    input.name = attributeName;
    input.value = value;
    if (checked) input.checked = true;
    span.textContent = label;

    // Add level and parent attributes for hierarchical structure
    if (level > 0) {
      labelEl.setAttribute('data-level', level);
      labelEl.setAttribute('data-parent-value', parentValue);
      labelEl.style.display = 'none'; // Initially hide sub-options
      labelEl.style.paddingLeft = '20px'; // Indent sub-options
    }

    if (count !== null) {
      countEl.textContent = count;
      countEl.style.display = 'inline';
    } else {
      countEl.style.display = 'none';
    }

    return labelEl.outerHTML;
  }).join('');

  const dropdownTemplate = document.getElementById('filter-dropdown-template');
  const clone = dropdownTemplate.content.cloneNode(true);
  const details = clone.querySelector('details');
  details.id = facetId;
  clone.querySelector('.filter-title').textContent = title;

  const dropdownContent = clone.querySelector('.filter-dropdown-content');
  if (searchable) {
    const searchWrapper = createElement('div', { className: 'filter-search' });
    const searchInput = createElement('input', {
      type: 'text',
      className: 'filter-search-input',
      placeholder: `Search ${title.toLowerCase()}...`
    });
    searchWrapper.appendChild(searchInput);
    dropdownContent.appendChild(searchWrapper);
  }
  const itemsWrapper = createElement('div', { className: 'filter-items' });
  itemsWrapper.innerHTML = filterItemsHtml;
  dropdownContent.appendChild(itemsWrapper);

  container.replaceWith(clone);

  const newContainer = document.getElementById(facetId);
  if (newContainer) {
    if (newContainer.tagName === 'DETAILS') {
      newContainer.open = false;
    }
    // Clicks inside the dropdown (checkboxes, the search box, etc.) shouldn't
    // reach the document-level listener that closes open dropdowns on outside clicks.
    newContainer.addEventListener('click', (event) => event.stopPropagation());
    newContainer.addEventListener('change', (event) => {
      if (event.target.tagName === 'INPUT') {
        if (attributeName === 'players') {
          const selectedValue = event.target.value;
          const allPlayerLabels = newContainer.querySelectorAll('label.filter-item[data-level]');

          // First, hide all sub-options
          allPlayerLabels.forEach(label => {
            const level = parseInt(label.dataset.level, 10);
            if (level > 0) {
              label.style.display = 'none';
            }
          });

          // Show sub-options based on selection
          if (selectedValue !== 'any') {
            let parentValue;
            if (selectedValue.includes('-')) {
              // A sub-option is selected - get its parent value
              parentValue = selectedValue.split('-')[0];
            } else {
              // A main player count is selected
              parentValue = selectedValue;
            }

            // Show all sub-options for this parent value
            allPlayerLabels.forEach(label => {
              const level = parseInt(label.dataset.level, 10);
              if (level > 0 && label.dataset.parentValue === parentValue) {
                label.style.display = 'flex';
              }
            });
          }
        }
        onFilterChange();
      }
    });

    const searchInput = newContainer.querySelector('.filter-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const query = searchInput.value.toLowerCase().trim();
        newContainer.querySelectorAll('.filter-items .filter-item').forEach(item => {
          const label = item.querySelector('.filter-label');
          const text = label ? label.textContent.toLowerCase() : '';
          item.classList.toggle('search-hidden', !text.includes(query));
        });
      });
    }

    const scrollHandler = () => {
      if (!newContainer.open) {
        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
        return;
      }
      const dropdownContent = newContainer.querySelector('.filter-dropdown-content');
      const summaryElement = newContainer.querySelector('summary');
      if (!dropdownContent || !summaryElement) return;

      const rect = summaryElement.getBoundingClientRect();
      const availableHeight = window.innerHeight - rect.bottom - 10;
      dropdownContent.style.maxHeight = `${Math.min(availableHeight, 400)}px`;
    };

    newContainer.addEventListener('toggle', function (event) {
      const dropdownContent = this.querySelector('.filter-dropdown-content');
      const summaryElement = this.querySelector('summary');
      if (!dropdownContent || !summaryElement) return;

      if (this.open) {
        this.style.position = 'relative';
        dropdownContent.style.position = 'absolute';
        dropdownContent.style.top = `${summaryElement.offsetHeight}px`;
        dropdownContent.style.left = '0';
        dropdownContent.style.zIndex = '1050';
        dropdownContent.style.minWidth = `${summaryElement.offsetWidth}px`;
        dropdownContent.style.display = 'flex';
        dropdownContent.style.overflowY = 'auto';

        // clientWidth, not innerWidth: mobile viewports expand to fit
        // overflowing content, which would hide the very overflow we measure
        const viewportMargin = 8;
        const viewportWidth = document.documentElement.clientWidth;
        const contentRect = dropdownContent.getBoundingClientRect();
        const overflowRight = contentRect.right - (viewportWidth - viewportMargin);
        if (overflowRight > 0) {
          const maxShift = Math.max(contentRect.left - viewportMargin, 0);
          dropdownContent.style.left = `${-Math.min(overflowRight, maxShift)}px`;
        }

        scrollHandler();
        window.addEventListener('scroll', scrollHandler, {
          passive: true
        });
        window.addEventListener('resize', scrollHandler, {
          passive: true
        });

        const searchInput = dropdownContent.querySelector('.filter-search-input');
        if (searchInput) {
          searchInput.value = '';
          dropdownContent.querySelectorAll('.filter-items .filter-item').forEach(item => {
            item.classList.remove('search-hidden');
          });
          searchInput.focus();
        }

      } else {
        this.style.position = '';
        dropdownContent.style.position = '';
        dropdownContent.style.top = '';
        dropdownContent.style.left = '';
        dropdownContent.style.zIndex = '';
        dropdownContent.style.minWidth = '';
        dropdownContent.style.display = '';
        dropdownContent.style.maxHeight = '';
        dropdownContent.style.overflowY = '';

        window.removeEventListener('scroll', scrollHandler);
        window.removeEventListener('resize', scrollHandler);
      }
    });

    const summary = newContainer.querySelector('summary');
    if (summary) {
      summary.addEventListener('click', function (e) {
        const details = this.parentElement;
        if (details.open) {
          e.preventDefault();
          details.open = false;
        }
      });
    }
  }
}

function updateClearButtonVisibility(filters) {
  const clearContainer = document.getElementById('clear-all');
  if (!clearContainer) return;

  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime
  } = filters;

  const isAnyFilterActive =
    (query && query !== '') ||
    (selectedCategories && selectedCategories.length > 0) ||
    (selectedMechanics && selectedMechanics.length > 0) ||
    (selectedPlayerFilter && selectedPlayerFilter !== 'any') ||
    (selectedWeight && selectedWeight.length > 0) ||
    (selectedPlayingTime && selectedPlayingTime.length > 0);

  clearContainer.style.display = isAnyFilterActive ? 'flex' : 'none';
}

function updateFilterActiveStates(filters) {
  // Update categories filter
  const categoriesFilter = document.getElementById('facet-categories');
  if (categoriesFilter) {
    if (filters.selectedCategories && filters.selectedCategories.length > 0) {
      categoriesFilter.classList.add('filter-active');
    } else {
      categoriesFilter.classList.remove('filter-active');
    }
  }

  // Update mechanics filter
  const mechanicsFilter = document.getElementById('facet-mechanics');
  if (mechanicsFilter) {
    if (filters.selectedMechanics && filters.selectedMechanics.length > 0) {
      mechanicsFilter.classList.add('filter-active');
    } else {
      mechanicsFilter.classList.remove('filter-active');
    }
  }

  // Update players filter
  const playersFilter = document.getElementById('facet-players');
  if (playersFilter) {
    if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') {
      playersFilter.classList.add('filter-active');
    } else {
      playersFilter.classList.remove('filter-active');
    }
  }

  // Update weight filter
  const weightFilter = document.getElementById('facet-weight');
  if (weightFilter) {
    if (filters.selectedWeight && filters.selectedWeight.length > 0) {
      weightFilter.classList.add('filter-active');
    } else {
      weightFilter.classList.remove('filter-active');
    }
  }

  // Update playing time filter
  const playingTimeFilter = document.getElementById('facet-playing-time');
  if (playingTimeFilter) {
    if (filters.selectedPlayingTime && filters.selectedPlayingTime.length > 0) {
      playingTimeFilter.classList.add('filter-active');
    } else {
      playingTimeFilter.classList.remove('filter-active');
    }
  }

}

function formatPlayerFilterChipLabel(value) {
  const [count, type] = value.split('-');
  const playerLabel = count === '1' ? 'player' : 'players';
  if (type === 'best') return `Best with ${count} ${playerLabel}`;
  if (type === 'recommended') return `Recommended with ${count} ${playerLabel}`;
  if (type === 'expansion') return `Expansions allow ${count} ${playerLabel}`;
  return `${count} ${playerLabel}`;
}

function removeCheckboxFilterValue(name, value) {
  const checkbox = document.querySelector(`input[type="checkbox"][name="${name}"][value="${CSS.escape(value)}"]`);
  if (checkbox) checkbox.checked = false;
}

function createCurrentFilterChip(label, value, onRemove) {
  const chip = createElement('span', { className: 'current-filter-chip' });
  chip.appendChild(createElement('span', {}, `${label}: ${value}`));
  const deleteBtn = createElement('button', { type: 'button', className: 'current-filter-delete', 'aria-label': `Remove ${label}: ${value}` }, '✕');
  deleteBtn.addEventListener('click', function () {
    onRemove();
    onFilterChange();
  });
  chip.appendChild(deleteBtn);
  return chip;
}

function updateCurrentFilters(filters) {
  const container = document.getElementById('current-filters');
  if (!container) return;
  container.innerHTML = '';

  if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') {
    const label = formatPlayerFilterChipLabel(filters.selectedPlayerFilter);
    container.appendChild(createCurrentFilterChip('Players', label, () => {
      const anyRadio = document.querySelector('input[name="players"][value="any"]');
      if (anyRadio) anyRadio.checked = true;
      hideAllPlayerSubOptions();
    }));
  }

  (filters.selectedPlayingTime || []).forEach(value => {
    container.appendChild(createCurrentFilterChip('Time', value, () => removeCheckboxFilterValue('playing_time', value)));
  });

  (filters.selectedWeight || []).forEach(value => {
    container.appendChild(createCurrentFilterChip('Weight', value, () => removeCheckboxFilterValue('weight', value)));
  });

  (filters.selectedCategories || []).forEach(value => {
    container.appendChild(createCurrentFilterChip('Categories', value, () => removeCheckboxFilterValue('categories', value)));
  });

  (filters.selectedMechanics || []).forEach(value => {
    container.appendChild(createCurrentFilterChip('Mechanics', value, () => removeCheckboxFilterValue('mechanics', value)));
  });
}

function getFiltersFromURL() {
  const params = new URLSearchParams(window.location.search);

  return {
    query: params.get('q') || '',
    selectedCategories: params.get('categories')?.split(',').filter(Boolean) || [],
    selectedMechanics: params.get('mechanics')?.split(',').filter(Boolean) || [],
    selectedPlayerFilter: params.get('players') || 'any',
    selectedWeight: params.get('weight')?.split(',').filter(Boolean) || [],
    selectedPlayingTime: params.get('playing_time')?.split(',').filter(Boolean) || [],
    sortBy: params.get('sort') || 'name',
    sortDir: params.get('dir') || getSortOption(params.get('sort') || 'name').defaultDir,
    page: Number(params.get('page')) || 1
  };
}

function getFiltersFromUI() {
  const query = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
  const selectedCategories = getSelectedValues('categories');
  const selectedMechanics = getSelectedValues('mechanics');
  const selectedPlayerFilter = document.querySelector('input[name="players"]:checked')?.value || 'any';
  const selectedWeight = getSelectedValues('weight');
  const selectedPlayingTime = getSelectedValues('playing_time');
  const sortBy = document.getElementById('sort-select')?.value || 'name';
  const sortDir = getSortDirButtonState();

  return {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime,
    sortBy,
    sortDir,
    page: currentPage
  };
}

function updateURLWithFilters(filters) {
  const params = new URLSearchParams();

  if (filters.query) params.set('q', filters.query);
  if (filters.selectedCategories?.length) params.set('categories', filters.selectedCategories.join(','));
  if (filters.selectedMechanics?.length) params.set('mechanics', filters.selectedMechanics.join(','));
  if (filters.selectedPlayerFilter && filters.selectedPlayerFilter !== 'any') params.set('players', filters.selectedPlayerFilter);
  if (filters.selectedWeight?.length) params.set('weight', filters.selectedWeight.join(','));
  if (filters.selectedPlayingTime?.length) params.set('playing_time', filters.selectedPlayingTime.join(','));
  if (filters.sortBy && filters.sortBy !== 'name') params.set('sort', filters.sortBy);
  if (filters.sortDir && filters.sortDir !== getSortOption(filters.sortBy).defaultDir) params.set('dir', filters.sortDir);
  if (filters.page && filters.page > 1) params.set('page', filters.page);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  history.replaceState(filters, '', newUrl);
}

function updateUIFromState(state) {
  const searchInput = document.getElementById('search-input');
  searchInput.value = state.query;
  const clearBtn = document.querySelector('.search-clear-btn');
  if (clearBtn) clearBtn.style.display = state.query ? 'flex' : 'none';

  document.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);

  const checkboxFilters = {
    'categories': state.selectedCategories,
    'mechanics': state.selectedMechanics,
    'weight': state.selectedWeight,
    'playing_time': state.selectedPlayingTime,
  };

  for (const name in checkboxFilters) {
    const values = checkboxFilters[name];
    if (values?.length) {
      values.forEach(value => {
        const cb = document.querySelector(`input[type="checkbox"][name="${name}"][value="${CSS.escape(value)}"]`);
        if (cb) cb.checked = true;
      });
    }
  }

  const playerRadio = document.querySelector(`input[name="players"][value="${state.selectedPlayerFilter}"]`);
  if (playerRadio) playerRadio.checked = true;

  // Always handle player filter sub-options visibility
  const allPlayerLabels = document.querySelectorAll('#facet-players label.filter-item[data-level]');

  if (state.selectedPlayerFilter && state.selectedPlayerFilter !== 'any') {
    if (state.selectedPlayerFilter.includes('-')) {
      // A sub-option is selected - show all sub-options for the same parent
      const parentValue = state.selectedPlayerFilter.split('-')[0];
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === parentValue ? 'flex' : 'none';
        }
      });
    } else {
      // A main player count is selected - show its sub-options
      const mainValue = state.selectedPlayerFilter;
      allPlayerLabels.forEach(label => {
        const level = parseInt(label.dataset.level, 10);
        if (level > 0) {
          label.style.display = label.dataset.parentValue === mainValue ? 'flex' : 'none';
        }
      });
    }
  } else {
    // Hide all sub-options when "any" is selected
    allPlayerLabels.forEach(label => {
      const level = parseInt(label.dataset.level, 10);
      if (level > 0) {
        label.style.display = 'none';
      }
    });
  }

  document.getElementById('sort-select').value = state.sortBy;
  setSortDirButtonState(state.sortDir || getSortOption(state.sortBy).defaultDir);
  currentPage = state.page;
}

function onFilterChange(resetPage = true) {
  const state = getFiltersFromUI();
  if (resetPage) {
    state.page = 1;
    currentPage = 1;
  }
  updateURLWithFilters(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function setupClearAllButton() {
  const clearContainer = document.getElementById('clear-all');
  const button = createElement('button', {
    id: 'clear-filters',
    className: 'clear-button'
  }, 'Clear filters');
  button.addEventListener('click', clearAllFilters);

  clearContainer.appendChild(button);
  clearContainer.style.display = 'none';
}

function filterGames(gamesToFilter, filters) {
  const {
    query,
    selectedCategories,
    selectedMechanics,
    selectedPlayerFilter,
    selectedWeight,
    selectedPlayingTime
  } = filters;

  return gamesToFilter.filter(game => {
    if (query && !game.name.toLowerCase().includes(query) &&
      !game.description.toLowerCase().includes(query)) {
      return false;
    }

    if (selectedCategories.length > 0 &&
      !selectedCategories.some(cat => game.categories.includes(cat))) {
      return false;
    }

    if (selectedMechanics.length > 0 &&
      !selectedMechanics.some(mech => game.mechanics.includes(mech))) {
      return false;
    }

    if (selectedPlayerFilter && selectedPlayerFilter !== 'any') {
      // Handle both simple player count (e.g., "2") and detailed format (e.g., "2-best")
      const filterParts = selectedPlayerFilter.split('-');
      const targetPlayers = Number(filterParts[0]);
      const requiredType = filterParts.length > 1 ? filterParts[1] : null;

      if (!isNaN(targetPlayers)) {
        const match = game.players.some(([count, type]) => {
          if (!count || type === 'not recommended') return false;

          // If a specific recommendation type is required, check for it
          if (requiredType && type !== requiredType) return false;

          const parsed = parsePlayerCount(count);
          if (parsed.open) {
            return targetPlayers === parsed.min;
          }
          return targetPlayers >= parsed.min && targetPlayers <= parsed.max;
        });

        if (!match) {
          return false;
        }
      }
    }

    if (selectedWeight.length > 0) {
      const gameWeightName = getComplexityName(game.weight);
      if (!gameWeightName || !selectedWeight.includes(gameWeightName)) {
        return false;
      }
    }

    if (selectedPlayingTime.length > 0 && !selectedPlayingTime.includes(game.playing_time)) {
      return false;
    }

    return true;
  });
}

function updateCountsInDOM(facetId, counts, showZero = false) {
  const facetContainer = document.getElementById(facetId);
  if (!facetContainer) return;

  const filterItems = facetContainer.querySelectorAll('.filter-item');
  filterItems.forEach(item => {
    const input = item.querySelector('input');
    if (!input) return;

    const value = input.value;
    const countSpan = item.querySelector('.facet-count');

    if (countSpan) {
      const newCount = counts[value] || 0;
      countSpan.textContent = newCount;

      // Special handling for player filter hierarchical structure
      if (facetId === 'facet-players') {
        const level = parseInt(item.dataset.level, 10) || 0;

        if (level > 0) {
          // This is a sub-option - show if:
          // 1. Its parent is selected, OR
          // 2. Any sub-option with the same parent is selected, OR
          // 3. This specific sub-option is selected
          const parentValue = item.dataset.parentValue;
          const parentInput = facetContainer.querySelector(`input[value="${parentValue}"]`);
          const anyInput = facetContainer.querySelector(`input[value="any"]`);

          // Check if any sub-option with the same parent is selected
          const anySubOptionSelected = Array.from(facetContainer.querySelectorAll(`input[type="radio"]`))
            .some(radio => radio.checked && radio.value.includes('-') && radio.value.startsWith(parentValue + '-'));

          // Sub-options should be visible if:
          // 1. Their specific parent is selected, OR
          // 2. Any sub-option for this parent is selected
          // AND "Any" is NOT selected
          const shouldShow = ((parentInput && parentInput.checked) || anySubOptionSelected) && !(anyInput && anyInput.checked);

          item.style.display = shouldShow ? 'flex' : 'none';
        } else {
          // This is a main option - show/hide based on count
          if (newCount === 0 && !input.checked && !showZero) {
            item.style.display = 'none';
          } else {
            item.style.display = 'flex';
          }
        }
      } else {
        // Normal handling for other filters
        if (newCount === 0 && !input.checked && !showZero) {
          item.style.display = 'none';
        } else {
          item.style.display = 'flex';
        }
      }
    }
  });
}

function updateAllFilterCounts(filters) {
  const catFilters = {
    ...filters,
    selectedCategories: []
  };
  const gamesForCatCount = filterGames(allGames, catFilters);
  const categoryCounts = {};
  gamesForCatCount.forEach(game => {
    game.categories.forEach(cat => {
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-categories', categoryCounts);

  const mechFilters = {
    ...filters,
    selectedMechanics: []
  };
  const gamesForMechCount = filterGames(allGames, mechFilters);
  const mechanicCounts = {};
  gamesForMechCount.forEach(game => {
    game.mechanics.forEach(mech => {
      mechanicCounts[mech] = (mechanicCounts[mech] || 0) + 1;
    });
  });
  updateCountsInDOM('facet-mechanics', mechanicCounts);

  const playerFilters = {
    ...filters,
    selectedPlayerFilter: 'any'
  };
  const gamesForPlayerCount = filterGames(allGames, playerFilters);
  const playerCounts = {};
  document.querySelectorAll('#facet-players input[type="radio"]').forEach(radio => {
    const value = radio.value;
    if (value === 'any') {
      playerCounts[value] = gamesForPlayerCount.length;
    } else if (value.includes('-')) {
      const [playersPart, recType] = value.split('-');
      const targetPlayers = Number(playersPart);
      const count = gamesForPlayerCount.filter(game =>
        game.players.some(([playerCount, type]) => {
          if (type !== recType) return false;
          const {
            min,
            max
          } = parsePlayerCount(playerCount);
          return targetPlayers >= min && targetPlayers <= max;
        })
      ).length;
      playerCounts[value] = count;
    } else {
      const targetPlayers = Number(value);
      const count = gamesForPlayerCount.filter(game =>
        game.players.some(([playerCount, type]) => {
          if (type === 'not recommended') return false;
          const {
            min,
            max
          } = parsePlayerCount(playerCount);
          return targetPlayers >= min && targetPlayers <= max;
        })
      ).length;
      playerCounts[value] = count;
    }
  });
  updateCountsInDOM('facet-players', playerCounts, true);

  const weightFilters = {
    ...filters,
    selectedWeight: []
  };
  const gamesForWeightCount = filterGames(allGames, weightFilters);
  const weightCounts = {};
  gamesForWeightCount.forEach(game => {
    if (game.weight) {
      const name = getComplexityName(game.weight);
      if (name) {
        weightCounts[name] = (weightCounts[name] || 0) + 1;
      }
    }
  });
  updateCountsInDOM('facet-weight', weightCounts);

  const playingTimeFilters = {
    ...filters,
    selectedPlayingTime: []
  };
  const gamesForPlayingTimeCount = filterGames(allGames, playingTimeFilters);
  const playingTimeCounts = {};
  gamesForPlayingTimeCount.forEach(game => {
    if (game.playing_time) {
      playingTimeCounts[game.playing_time] = (playingTimeCounts[game.playing_time] || 0) + 1;
    }
  });
  updateCountsInDOM('facet-playing-time', playingTimeCounts);
}

function applyFiltersAndSort(filters) {
  updateClearButtonVisibility(filters);
  updateFilterActiveStates(filters);
  updateAllFilterCounts(filters);
  updateCurrentFilters(filters);

  filteredGames = filterGames(allGames, filters);

  const getSortValue = SORT_VALUE_GETTERS[filters.sortBy] || SORT_VALUE_GETTERS.name;
  const dir = filters.sortDir === 'desc' ? 'desc' : 'asc';

  filteredGames.sort((a, b) => {
    const va = getSortValue(a);
    const vb = getSortValue(b);
    const aMissing = isMissingSortValue(va);
    const bMissing = isMissingSortValue(vb);

    // Missing values always sort last, regardless of asc/desc.
    if (aMissing || bMissing) {
      if (aMissing && bMissing) return 0;
      return aMissing ? 1 : -1;
    }

    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return dir === 'desc' ? -cmp : cmp;
  });
}

const SORT_VALUE_GETTERS = {
  name: game => game.name,
  rank: game => game.rank,
  my_rating: game => game.my_rating,
  weight: game => game.weight,
  playing_time: game => game.playing_time_minutes
};

function isMissingSortValue(value) {
  return value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));
}

function getSelectedValues(name) {
  const checkboxes = document.querySelectorAll(`input[name="${name}"]:checked`);
  return Array.from(checkboxes).map(cb => cb.value);
}

function getSelectedRange(name) {
  const radio = document.querySelector(`input[name="${name}"]:checked`);
  if (!radio || radio.value === '0-100' || radio.value === '0-9999') return null;

  const [min, max] = radio.value.split('-').map(Number);
  return { min, max };
}

function clearAllFilters() {
  history.pushState({}, '', window.location.pathname);
  const state = getFiltersFromURL();
  updateUIFromState(state);
  applyFiltersAndSort(state);
  updateResults();
  updateStats();
}

function updateResults() {
  const container = document.getElementById('hits');
  const startIdx = (currentPage - 1) * GAMES_PER_PAGE;
  const endIdx = startIdx + GAMES_PER_PAGE;
  const pageGames = filteredGames.slice(startIdx, endIdx);

  if (pageGames.length === 0) {
    const template = document.getElementById('no-results-template');
    const clone = template.content.cloneNode(true);
    container.innerHTML = '';
    container.appendChild(clone);
    updatePagination();
    return;
  }

  const gridTemplate = document.getElementById('game-grid-template');
  const gridClone = gridTemplate.content.cloneNode(true);
  const gameGrid = gridClone.querySelector('.game-grid');

  pageGames.forEach(game => {
    gameGrid.appendChild(renderGameCard(game));
  });

  container.innerHTML = '';
  container.appendChild(gridClone);

  on_render();
  updatePagination();
}

function renderGameCard(game) {
  const template = document.getElementById('game-card-template');
  const clone = template.content.cloneNode(true);
  const card = clone.querySelector('.game-card');

  // Set basic card data
  card.setAttribute('data-color', game.color || '200,200,200');

  // Set images
  const summaryImg = clone.querySelector('.game-image');
  const coverImg = clone.querySelector('.cover-image-img');
  summaryImg.src = game.image;
  summaryImg.alt = game.name;
  coverImg.src = game.image;
  coverImg.alt = game.name;
  clone.querySelector('.game-title-text').textContent = game.name;
  const metaStats = [];
  if (game.playing_time) {
    metaStats.push(`<span class="stat-text"><span class="stat-label">Playing time</span><span class="stat-value">${game.playing_time}</span></span>`);
  }
  if (game.players && game.players.length > 0) {
    metaStats.push(`<span class="stat-text"><span class="stat-label">Players</span><span class="stat-value">${formatPlayerCountBold(game.players)}</span></span>`);
  }
  if (typeof game.weight === 'number' && !isNaN(game.weight)) {
    metaStats.push(`<span class="stat-text"><span class="stat-label">Weight</span><span class="stat-value">${game.weight.toFixed(2)}</span></span>`);
  }
  clone.querySelector('.game-meta-text').innerHTML = metaStats.join('');

  // Set title
  const title = clone.querySelector('.game-title');
  title.innerHTML = highlightText(game.name, getCurrentSearchQuery());

  // Set category chips
  const categoryChips = formatCategoryChips(game);
  if (categoryChips) {
    clone.querySelector('.category-chips-container-detail').innerHTML = categoryChips;
  }

  // Set stats bar items
  const playingTimeStat = clone.querySelector('.playing-time-stat');
  if (game.playing_time) {
    playingTimeStat.style.display = 'flex';
    clone.querySelector('.playing-time-value').textContent = game.playing_time;
  }

  const playersStat = clone.querySelector('.players-stat');
  if (game.players.length > 0) {
    playersStat.style.display = 'flex';
    clone.querySelector('.players-value').innerHTML = formatPlayerCountBold(game.players);
  }

  const complexityStat = clone.querySelector('.complexity-stat');
  if (typeof game.weight === 'number' && !isNaN(game.weight)) {
    complexityStat.style.display = 'flex';
    clone.querySelector('.complexity-value').textContent = `${game.weight.toFixed(2)} (${getComplexityName(game.weight)})`;
  }

  // Set description
  const teaserText = clone.querySelector('.teaser-text');
  teaserText.textContent = game.description || 'No description available.';

  // Set mechanic chips
  const mechanicContainer = clone.querySelector('.mechanic-chips-container');
  const mechanicChips = formatMechanicChips(game);
  if (mechanicChips) {
    mechanicContainer.innerHTML = mechanicChips;
  }

  // Set expansions
  const expansionsSection = clone.querySelector('.expansions-section');
  if (game.expansions && game.expansions.length > 0) {
    expansionsSection.style.display = 'block';
    const container = clone.querySelector('.expansion-chips');
    const tileTemplate = document.getElementById('expansion-tile-template');
    const chipTemplate = document.getElementById('expansion-chip-template');

    // Databases indexed before expansion images were added have no image field
    if (game.expansions.some(exp => exp.image)) {
      container.classList.add('expansion-grid');
    }

    const expansionLinks = game.expansions.map((exp) => {
      const template = exp.image ? tileTemplate : chipTemplate;
      const expClone = template.content.cloneNode(true);
      const link = expClone.querySelector('a');
      link.href = `https://boardgamegeek.com/boardgame/${exp.id}`;
      if (exp.image) {
        const thumb = link.querySelector('.expansion-thumb');
        thumb.src = exp.image;
        thumb.alt = exp.name;
        link.querySelector('.expansion-tile-name').textContent = exp.name;
        link.title = exp.name;
      } else {
        link.textContent = exp.name;
      }
      return link.outerHTML;
    }).join('');
    container.innerHTML = expansionLinks;
  }

  // Set BGG link
  const bggLink = clone.querySelector('.bgg-link-header');
  if (bggLink && game.id) {
    bggLink.href = `https://boardgamegeek.com/boardgame/${game.id}`;
  }

  return clone;
}

function formatCategoryChips(game) {
  if (!game.categories || game.categories.length === 0) {
    return '';
  }
  const template = document.getElementById('category-chip-template');
  const categoriesHtml = game.categories.map(cat => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = cat;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(categoriesHtml);
}

function formatMechanicChips(game) {
  if (!game.mechanics || game.mechanics.length === 0) {
    return '';
  }
  const template = document.getElementById('mechanic-chip-template');
  const mechanicsHtml = game.mechanics.map(mech => {
    const clone = template.content.cloneNode(true);
    const chip = clone.querySelector('.tag-chip');
    chip.textContent = mech;
    return chip.outerHTML;
  }).join('');
  return createTagChipsContainer(mechanicsHtml);
}

function formatPlayerCount(players) {
  return players.map(([count, type]) => {
    const suffix = type === 'best' ? ' (best)' : type === 'recommended' ? ' (rec.)' : '';
    return count + suffix;
  }).join(', ');
}

function formatPlayerCountBold(players) {
  if (players.length === 0) return '';

  const MAX_INDIVIDUAL = 8;
  if (players.length > MAX_INDIVIDUAL) {
    const nums = players.map(([count]) => parseInt(count)).filter(n => !isNaN(n));
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const hasOpenEnd = players.some(([count]) => String(count).includes('+'));
    const bestCounts = players.filter(([, type]) => type === 'best').map(([count]) => count);
    const rangeStr = `${min}-${max}${hasOpenEnd ? '+' : ''}`;
    if (bestCounts.length > 0 && bestCounts.length <= 3) {
      return `${rangeStr} (best: ${bestCounts.map(c => `<strong>${c}</strong>`).join(', ')})`;
    }
    return rangeStr;
  }

  return players.map(([count, type]) => {
    return type === 'best' ? `<strong>${count}</strong>` : count;
  }).join(', ');
}

function formatPlayerCountShort(players) {
  if (players.length === 0) return '';
  if (players.length === 1) return players[0][0];

  const minPlayers = Math.min(...players.map(p => parseInt(p[0])));
  const maxPlayers = Math.max(...players.map(p => parseInt(p[0])));

  return `${minPlayers}${minPlayers !== maxPlayers ? `-${maxPlayers}` : ''}`;
}

function getComplexityName(score) {
  if (isNaN(score) || score <= 0) return '';
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[0]) return CONFIG.COMPLEXITY_NAMES[0];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[1]) return CONFIG.COMPLEXITY_NAMES[1];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[2]) return CONFIG.COMPLEXITY_NAMES[2];
  if (score < CONFIG.COMPLEXITY_THRESHOLDS[3]) return CONFIG.COMPLEXITY_NAMES[3];
  return CONFIG.COMPLEXITY_NAMES[4];
}

function highlightText(text, query) {
  if (!query || query.length < 2) return text;

  const regex = new RegExp(`(${query})`, 'gi');
  return text.replace(regex, '<strong class="highlight">$1</strong>');
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > 0 ? truncated.substring(0, lastSpace) : truncated) + '...';
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('search-input');
  return searchInput ? searchInput.value.toLowerCase().trim() : '';
}

function updateStats() {
  const statsContainer = document.getElementById('stats');
  const totalGames = filteredGames.length;
  const totalAllGames = allGames.length;

  let statsText = `${totalGames.toLocaleString()}`;
  if (totalGames !== totalAllGames) {
    statsText += ` of ${totalAllGames.toLocaleString()}`;
  }
  statsContainer.textContent = `${statsText} games`;
}

function createPaginationButton(page, text, isCurrent = false) {
  const template = document.getElementById('pagination-button-template');
  const clone = template.content.cloneNode(true);
  const button = clone.querySelector('.pagination-btn');

  button.textContent = text || page;
  button.onclick = () => goToPage(page);

  if (isCurrent) {
    button.className += ' current';
  }

  return button;
}

function createPaginationEllipsis() {
  const template = document.getElementById('pagination-ellipsis-template');
  const clone = template.content.cloneNode(true);
  return clone.querySelector('span');
}

function updatePagination() {
  const container = document.getElementById('pagination');
  const totalPages = Math.ceil(filteredGames.length / GAMES_PER_PAGE);

  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }

  const template = document.getElementById('pagination-template');
  const clone = template.content.cloneNode(true);
  const paginationDiv = clone.querySelector('.pagination');

  // Clear existing content
  paginationDiv.innerHTML = '';

  if (currentPage > 1) {
    paginationDiv.appendChild(createPaginationButton(currentPage - 1, '‹ Previous'));
  }

  const startPage = Math.max(1, currentPage - 2);
  const endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1) {
    paginationDiv.appendChild(createPaginationButton(1));
    if (startPage > 2) paginationDiv.appendChild(createPaginationEllipsis());
  }

  for (let i = startPage; i <= endPage; i++) {
    const isCurrentPage = i === currentPage;
    paginationDiv.appendChild(createPaginationButton(i, i, isCurrentPage));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) paginationDiv.appendChild(createPaginationEllipsis());
    paginationDiv.appendChild(createPaginationButton(totalPages));
  }

  if (currentPage < totalPages) {
    paginationDiv.appendChild(createPaginationButton(currentPage + 1, 'Next ›'));
  }

  container.innerHTML = '';
  container.appendChild(clone);
}

function goToPage(page) {
  currentPage = page;
  const state = getFiltersFromUI();
  updateURLWithFilters(state);
  updateResults();
  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function on_render() {
  const isListView = document.getElementById('hits')?.classList.contains('list-view');
  const gameCards = document.querySelectorAll(".game-card");
  gameCards.forEach(function (card) {
    const color = card.getAttribute("data-color") || "200,200,200";

    if (isListView) {
      card.style.setProperty('--tint-color', color);
    }

    const gameDetails = card.querySelector(".game-details");
    if (gameDetails) {
      gameDetails.style.backgroundColor = '#FFFFFF';

      const cardHeader = card.querySelector(".card-header");
      if (cardHeader) {
        cardHeader.style.backgroundColor = `rgba(${color}, 0.1)`;
        cardHeader.style.color = '#333';
      }

      const statsBar = card.querySelector(".stats-bar");
      if (statsBar) {
        statsBar.style.backgroundColor = `rgba(${color}, 0.1)`;
      }

      const gameDetailsIcons = gameDetails.querySelectorAll(".icon-themed");
      gameDetailsIcons.forEach(function (icon) {
        if (icon.classList.contains('icon-circle')) {
          icon.style.backgroundColor = `rgba(${color}, 0.2)`;
          icon.style.color = '#333';
        } else {
          icon.style.color = `rgb(${color})`;
        }
      });
    }
  });

  setupGameDetails();
}

function setupGameDetails() {
  const summaries = document.querySelectorAll(".game-summary");
  summaries.forEach(function (elem) {
    function conditionalClose() {
      closeAllDetails();
      if (!elem.parentElement.hasAttribute("open")) {
        const gameDetails = elem.parentElement.querySelector(".game-details");
        if (gameDetails) {
          gameDetails.focus();
        }
      }
    }
    elem.addEventListener("click", conditionalClose);
  });

  const gameDetails = document.querySelectorAll(".game-details");
  gameDetails.forEach(function (elem) {
    let closeButton = elem.querySelector('.close-button');

    function closeDetails(event) {
      elem.parentElement.removeAttribute("open");
      event.stopPropagation();
    }

    if (closeButton) {
      closeButton.addEventListener("click", closeDetails);
      closeButton.addEventListener("keypress", closeDetails);
    }

    elem.addEventListener("click", function (event) {
      event.stopPropagation();
    });
  });

}

function closeAllDetails() {
  const openDetails = document.querySelectorAll("details[open]");
  openDetails.forEach(function (elem) {
    elem.removeAttribute("open");
  });
}

function closeAll(event) {
  closeAllDetails();
}

document.addEventListener("click", closeAll);

function setViewMode(mode) {
  const hits = document.getElementById('hits');
  const gridBtn = document.getElementById('grid-view-btn');
  const listBtn = document.getElementById('list-view-btn');
  if (!hits || !gridBtn || !listBtn) return;

  if (mode === 'list') {
    hits.classList.add('list-view');
    listBtn.style.display = 'none';
    gridBtn.style.display = 'flex';
  } else {
    hits.classList.remove('list-view');
    gridBtn.style.display = 'none';
    listBtn.style.display = 'flex';
  }
  localStorage.setItem('viewMode', mode);
  on_render();
}

document.getElementById('grid-view-btn').addEventListener('click', function () {
  setViewMode('grid');
});
document.getElementById('list-view-btn').addEventListener('click', function () {
  setViewMode('list');
});
setViewMode(localStorage.getItem('viewMode') || 'grid');

function init(settings) {
  console.log('Initializing GameCache SQLite app...');
  const gamesPerPage = parseInt(settings.games_per_page, 10);
  if (gamesPerPage > 0) {
    GAMES_PER_PAGE = gamesPerPage;
  }
  initializeDatabase(settings);
}

loadINI('./config.ini', function (settings) {
  console.log('Settings loaded:', settings);
  init(settings);
});
