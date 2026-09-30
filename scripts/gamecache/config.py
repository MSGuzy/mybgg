"""
Configuration parsing utilities for GameCache project.
"""

import os
from pathlib import Path


def parse_config_file(config_path="config.txt"):
    """Parse simple key=value config file"""
    config = {}
    config_file = Path(config_path)

    if not config_file.exists():
        raise FileNotFoundError(f"Config file {config_path} not found")

    with open(config_file, 'r', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()

            # Skip empty lines and comments
            if not line or line.startswith('#'):
                continue

            # Parse key=value
            if '=' not in line:
                raise ValueError(f"Invalid config line {line_num}: {line}")

            key, value = line.split('=', 1)
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            elif value.startswith("'") and value.endswith("'"):
                value = value[1:-1]

            config[key] = value

    return config


def _read_secret(name):
    """Read a secret from the environment, falling back to a .env file."""
    value = os.environ.get(name)
    if value:
        return value

    # Look for .env in: current dir, or repo root
    env_locations = [
        Path('.env'),
        Path(__file__).parent.parent.parent / '.env',  # repo root from scripts/gamecache/config.py
    ]
    for env_file in env_locations:
        if env_file.exists():
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line.startswith(f'{name}='):
                        return line.split('=', 1)[1].strip()
    return None


def create_nested_config(config):
    """Convert flat config to nested structure for backward compatibility"""
    nested = {
        "project": {
            "title": config["title"]
        },
        "boardgamegeek": {
            "user_name": config["bgg_username"]
        },
        "github": {
            "repo": config["github_repo"]
        }
    }
    
    bgg_token = _read_secret('GAMECACHE_BGG_TOKEN')

    # The account password is only needed for private collection fields
    # (acquisition date), which BGG doesn't return to API tokens.
    bgg_password = _read_secret('GAMECACHE_BGG_PASSWORD')
    if bgg_password:
        nested["boardgamegeek"]["password"] = bgg_password

    # Fall back to config file if still not found
    if bgg_token:
        nested["boardgamegeek"]["token"] = bgg_token
    elif "bgg_token" in config:
        nested["boardgamegeek"]["token"] = config["bgg_token"]
    
    return nested

