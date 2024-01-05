var currentViewMode = 'grid-view'; // Default view mode


// Function to be called when the elements are available
function onElementsLoaded() {
    setDefaultView();
    toggleView();
}

// MutationObserver callback function
function callback(mutationsList, observer) {
    for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {
            var containerView = document.querySelector('.ais-Hits-list');
            var gridViewBtn = document.getElementById('grid-view-btn');
            var listViewBtn = document.getElementById('list-view-btn');

            if (containerView && gridViewBtn && listViewBtn) {
                onElementsLoaded();
                observer.disconnect(); // Stop observing once elements are found
                break;
            }
        }
    }
}

// Create a new MutationObserver and start observing
var observer = new MutationObserver(callback);
observer.observe(document.body, {
    childList: true,
    subtree: true
});


function mapFacetName(facetName) {
    const nameMap = {
        'players.level1': 'Players',
        'weight': 'Complexity',
        'playing_time': 'Time',

    };
    return nameMap[facetName] || facetName; // Return the mapped name or the original if not found
}

function loadJSON(path, callback) {
    var req = new XMLHttpRequest();
    req.overrideMimeType("application/json");
    req.open('GET', path, true);
    req.onreadystatechange = function () {
        if (req.readyState == 4 && req.status == "200") {
            callback(JSON.parse(req.responseText));
        }
    };
    req.send(null);
}

function hitClickHandler() {
    var gameDetails = this.querySelector(".game-details");
    if (gameDetails) {
        gameDetails.style.display = (gameDetails.style.display === '' || gameDetails.style.display === 'none') ? 'block' : 'none';
    }
}

function close_all(event) {
    var details = document.querySelectorAll("details");
    details.forEach(function (details_elem) {
        if (details_elem.hasAttribute("open")) {
            details_elem.removeAttribute("open");
        }
    });
}

function on_render() {
    var containerView = document.querySelector('.ais-Hits-list');
    if (containerView) {
        var hits = document.querySelectorAll(".ais-Hits-item");
        hits.forEach(function (hit) {
            if (currentViewMode === 'list-view') {
                hit.removeEventListener("click", hitClickHandler);
                hit.addEventListener("click", hitClickHandler);
            }

            // Moved inside the forEach loop
            var color = hit.querySelector("img").getAttribute("data-maincolor");
            hit.setAttribute("style", "background: rgba(" + color + ", 0.10)");

            hit.addEventListener("mouseover", function () {
                this.style.backgroundColor = "rgba(" + color + ", 0.20)";
            });

            hit.addEventListener("mouseout", function () {
                this.style.backgroundColor = "rgba(" + color + ", 0.10)";
            });
        });
    }
    if ("ontouchstart" in window) {
        function close_all_panels(facets) {
            facets.querySelectorAll(".facet .ais-Panel-body").forEach(function (panel_body) {
                panel_body.style.display = "none";
            });
        }

        function toggle_panel(facet) {
            var panel_body = facet.querySelector(".ais-Panel-body");
            var style = window.getComputedStyle(panel_body);
            if (style.display == "none") {
                close_all_panels(facet.parentElement);
                panel_body.style.display = "inline-block";
            } else {
                panel_body.style.display = "none";
            }
        }

        var facets = document.querySelectorAll(".facet");
        facets.forEach(function (facet) {
            var is_loaded = facet.getAttribute("loaded");
            if (!is_loaded) {
                facet.addEventListener("click", function (event) {
                    toggle_panel(facet);
                    event.stopPropagation();
                });
                facet.setAttribute("loaded", true);
            }
        });
    }
}




//this line seems to be causing issues
document.addEventListener("click", close_all);

adjustFacetDropdownPosition();

function attachFacetEvents() {
    const facets = document.querySelectorAll('.facet');
    facets.forEach(facet => {
        // Add mouseover event listener to each facet
        facet.addEventListener('mouseover', adjustFacetDropdownPosition);
    });
}

function get_widgets(SETTINGS) {
    const WEIGHT_LABELS = [
    "Light",
    "Light Medium",
    "Medium",
    "Medium Heavy",
    "Heavy"
  ];
    const PLAYING_TIME_ORDER = [
    '< 30min',
    '30min - 1h',
    '1-2h',
    '2-3h',
    '3-4h',
    '> 4h'
  ];

    function panel(header) {
        return instantsearch.widgets.panel({
            templates: {
                header: "<h3>" + header + "</h3>"
            }
        })
    }

    return {
        "search": instantsearch.widgets.searchBox({
            container: '#search-box',
            placeholder: 'Search for games'
        }),
        "sort": instantsearch.widgets.sortBy({
            container: '#sort-by',
            items: [
                {
                    label: 'Name ▾',
                    value: SETTINGS.algolia.index_name
                },
                {
                    label: 'BGG Rank ▾',
                    value: SETTINGS.algolia.index_name + '_rank_ascending'
                }, {
                    label: 'Weight ▴',
                    value: SETTINGS.algolia.index_name + '_weight_ascending'
                },
                {
                    label: 'Time ▴',
                    value: SETTINGS.algolia.index_name + '_time_ascending'
                }
      ]
        }),
        "clear": instantsearch.widgets.clearRefinements({
            container: '#clear-all',
            templates: {
                resetLabel: 'Clear all'
            }
        }),
        "refine_categories": panel('Categories')(instantsearch.widgets.refinementList)({
            container: '#facet-categories',
            collapsible: true,
            attribute: 'categories',
            operator: 'and',
            limit: 50,
            searchable: true,
        }),
        "refine_mechanics": panel('Mechanics')(instantsearch.widgets.refinementList)({
            container: '#facet-mechanics',
            collapsible: true,
            attribute: 'mechanics',
            operator: 'and',
            limit: 50,
            searchable: true,
        }),
        "refine_players": panel('Players')(instantsearch.widgets.hierarchicalMenu)({
            container: '#facet-players',
            collapsible: true,
            attributes: ['players.level1', 'players.level2'],
            operator: 'or',
            sortBy: function (a, b) {
                return parseInt(a.name) - parseInt(b.name);
            },
            transformItems: items => items.map(item => {
                const playerCount = parseInt(item.label);
                // Check if the player count is 1 to avoid plural
                const playerLabel = playerCount === 1 ? 'player' : 'players';
                return {
                    ...item,
                    label: `${item.label} ${playerLabel}`
                };
            }),
        }),
        "refine_weight": panel('Complexity')(instantsearch.widgets.refinementList)({
            container: '#facet-weight',
            attribute: 'weight',
            operator: 'or',
            sortBy: function (a, b) {
                return WEIGHT_LABELS.indexOf(a.name) - WEIGHT_LABELS.indexOf(b.name);
            },
        }),
        "refine_playingtime": panel('Time')(instantsearch.widgets.refinementList)({
            container: '#facet-playing-time',
            attribute: 'playing_time',
            operator: 'or',
            sortBy: function (a, b) {
                return PLAYING_TIME_ORDER.indexOf(a.name) - PLAYING_TIME_ORDER.indexOf(b.name);
            },
        }),
        "hits": instantsearch.widgets.hits({
            container: '#hits',
            transformItems: function (items) {

                return items.map(function (game) {
                    players = [];
                    game.players.forEach(function (num_players) {
                        match = num_players.level2.match(/^\d+\ >\ ([\w\ ]+)\ (?:with|allows)\ (\d+\+?)$/);
                        type = match[1].toLowerCase();
                        num = match[2];

                        type_callback = {
                            'best': function (num) {
                                return '<strong>' + num + '</strong><span title="Best with"></span>';
                            },
                            'recommended': function (num) {
                                return num;
                            },
                            'expansion': function (num) {
                                return num + '<span title="With expansion">⊕</span>';
                            },
                        };
                        players.push(type_callback[type](num));

                        if (num.indexOf("+") > -1) {
                            return;
                        }
                    });
                    game.players_str = players.join(", ");
                    game.categories_str = game.categories.join(", ");
                    game.mechanics_str = game.mechanics.join(", ");
                    game.tags_str = game.tags.join(", ");
                    game.description = game.description.trim();
                    game.has_expansions = (game.expansions.length > 0);
                    game.has_more_expansions = (game.has_more_expansions);

                    if (typeof game.numeric_weight !== 'undefined' && game.numeric_weight !== null) {
                        game.weight_display = game.numeric_weight.toFixed(2);
                    } else {
                        game.weight_display = game.weight; // Fallback if weight_exact is not available
                    }



                    if (game.has_more_expansions) {
                        game_prefix = game.name.indexOf(":") ? game.name.substring(0, game.name.indexOf(":")) : game.name;
                        expansions_url_data = {
                            searchstr: game_prefix,
                            searchfield: "title",
                            objecttype: "thing",
                            subtype: "boardgameexpansion",
                        };
                        has_more_expansions_url = (
                            "https://boardgamegeek.com/collection/user/" +
                            encodeURIComponent(SETTINGS.boardgamegeek.user_name) +
                            "?" +
                            (Object.keys(expansions_url_data).map(function (key) {
                                return key + "=" + expansions_url_data[key];
                            })).join("&") // Don't encode game_prefix, because bgg redirects indefinately then...
                        );
                        game.has_more_expansions_url = has_more_expansions_url;
                    }



                    return game;
                });
            },
            templates: {
                empty: 'No results',
                item: document.getElementById('hits-template').innerHTML
            }
        }),
        "stats": instantsearch.widgets.stats({
            container: '#stats'
        }),
        "pagination": instantsearch.widgets.pagination({
            container: '#pagination',
            maxPages: 20,
            showFirst: false,
            showLast: false
        }),
        "currentRefinements": instantsearch.widgets.currentRefinements({
            container: '#current-filters',
            templates: {
                item: '{{#helpers.highlight}}{ "attribute": "label" }{{/helpers.highlight}}',
            },
            transformItems: items => {
                return items.map(item => {
                    // Map the item label
                    const mappedName = mapFacetName(item.attribute);
                    item.label = mappedName;

                    // Check if the item is for player count and adjust the category label
                    if (item.attribute.startsWith('players')) {
                        item.refinements = item.refinements.map(refinement => {
                            refinement.label = refinement.label.replace(/^\d+\s>\s/, '');
                            return refinement;
                        });
                    }
                    return item;
                }).reverse();
            }
        }),

    }
}

function hide_facet_when_no_data(facet_id, games, attr) {
    var has_data_in_attr = false;
    for (game of games) {
        if (game[attr] != [] && game[attr] != "" && game[attr] != 0 && game[attr] != undefined) {
            has_data_in_attr = true;
            break;
        }
    }
    var widget = document.querySelector(facet_id);
    var widget_is_selected = document.querySelector(facet_id + " *[class$='-item--selected']");
    if (!has_data_in_attr && !widget_is_selected) {
        widget.style.display = 'none';
    } else {
        widget.style.display = 'block';
    }
}

function init(SETTINGS) {

    var configIndexName = ''
    switch (SETTINGS.algolia.sort_by) {
        case undefined:
        case 'asc(name)':
            configIndexName = SETTINGS.algolia.index_name
            break
        case 'asc(rank)':
        case 'desc(rating)':
            configIndexName = SETTINGS.algolia.index_name + '_rank_ascending'
            break
        case 'desc(weight)':
            configIndexName = SETTINGS.algolia.index_name + '_weight_ascending'
            break
        case 'desc(playing_time)':
            configIndexName = SETTINGS.algolia.index_name + '_time_ascending'
            break
        default:
            console.error("The provided config value for algolia.sort_by was invalid: " + SETTINGS.algolia.sort_by)
            break;
    }

    const search = instantsearch({
        indexName: configIndexName,
        searchClient: algoliasearch(
            SETTINGS.algolia.app_id,
            SETTINGS.algolia.api_key_search_only
        ),
        routing: true
    });

    search.on('render', on_render);

    var widgets = get_widgets(SETTINGS);
    search.addWidgets([
    widgets["search"],
    widgets["sort"],
    widgets["clear"],
    widgets["refine_categories"],
    widgets["refine_mechanics"],
    widgets["refine_players"],
    widgets["refine_weight"],
    widgets["refine_playingtime"],
    widgets["hits"],
    widgets["stats"],
    widgets["pagination"],
    widgets["currentRefinements"]
  ]);

    search.start();


    attachFacetEvents();

    //Set the default view and toggle functionality

    // Delay the execution of setDefaultView and toggleView



    function set_bgg_name() {
        var title = SETTINGS.project.title;
        if (!title) {
            title = "All " + SETTINGS.boardgamegeek.user_name + "'s boardgames";
        }

        var title_tag = document.getElementsByTagName("title")[0];
        title_tag.innerHTML = title;
    }
    set_bgg_name();
}

loadJSON("config.json", init);

//custom functions below

function setDefaultView() {
    var containerView = document.querySelector('.ais-Hits-list');
    var gridViewBtn = document.getElementById('grid-view-btn');
    var listViewBtn = document.getElementById('list-view-btn');
    if (containerView) {
        containerView.classList.add('grid-view');
        containerView.classList.remove('list-view');
        currentViewMode = 'grid-view';
        gridViewBtn.style.display = 'none'; // Hide grid view button
        listViewBtn.style.display = 'flex'; // Show list view button
        on_render(); // Call on_render here after setting the default view
    }
}

function toggleView() {
    var containerView = document.querySelector('.ais-Hits-list');
    var gridViewBtn = document.getElementById('grid-view-btn');
    var listViewBtn = document.getElementById('list-view-btn');

    if (gridViewBtn && listViewBtn && containerView) {
        gridViewBtn.addEventListener('click', function () {
            containerView.classList.add('grid-view');
            containerView.classList.remove('list-view');
            currentViewMode = 'grid-view';
            gridViewBtn.style.display = 'none'; // Hide grid view button
            listViewBtn.style.display = 'flex'; // Show list view button
            on_render(); // Refresh the view
        });

        listViewBtn.addEventListener('click', function () {
            containerView.classList.add('list-view');
            containerView.classList.remove('grid-view');
            currentViewMode = 'list-view';
            listViewBtn.style.display = 'none'; // Hide list view button
            gridViewBtn.style.display = 'flex'; // Show grid view button
            on_render(); // Refresh the view
        });
    }
}




function addCloseButtons() {
    var gameDetails = document.querySelectorAll(".game-details");
    gameDetails.forEach(function (elem) {
        // Check if the close button already exists to avoid duplicates
        if (!elem.querySelector('.close')) {
            var close = document.createElement("div");
            close.setAttribute("class", "close");
            close.setAttribute("tabindex", "0");
            close.innerHTML = "&times;";
            elem.appendChild(close);

            // Add event listener to close button
            close.addEventListener('click', function () {
                elem.style.display = 'none'; // Hide the game details
                elem.closest('.ais-Hits-item').classList.remove('details-visible'); // Update class
            });
        }
    });
}

function adjustFacetDropdownPosition() {
    const facets = document.querySelectorAll('.facet');
    facets.forEach(facet => {
        const panelBody = facet.querySelector('.ais-Panel-body');
        if (panelBody) {
            const facetRect = facet.getBoundingClientRect();
            const panelBodyRect = panelBody.getBoundingClientRect();
            const rightEdge = window.innerWidth;
            const leftEdge = 0;

            // Check if the dropdown extends beyond the right edge of the window
            if (facetRect.right + panelBodyRect.width > rightEdge) {
                // Check if aligning to the left edge causes it to go off-screen on the left
                if (facetRect.left - panelBodyRect.width < leftEdge) {
                    // Center the dropdown with the facet
                    panelBody.style.left = '50%';
                    panelBody.style.transform = 'translateX(-50%)';
                    panelBody.style.right = 'auto';
                } else {
                    // Align to the left edge of the facet
                    panelBody.style.left = 'auto';
                    panelBody.style.right = '0';
                }
            } else {
                // Default position (aligned with the left edge of the facet)
                panelBody.style.left = '0';
                panelBody.style.right = 'auto';
                panelBody.style.transform = 'none';
            }
        }
    });
}

// Call this function after facets are rendered and on window resize
window.addEventListener('resize', adjustFacetDropdownPosition);

//wait until everything is loaded to display
window.addEventListener('load', function () {
    document.body.style.display = 'block';
});
