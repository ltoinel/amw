"""MkDocs hook: keep the emoji icons of the nav labels out of the search index.

Pages are titled after their first heading, but a page without a top-level
Markdown heading (the home page, whose title sits in the hero HTML block)
falls back to its nav label, icon included, and would show up as "🏠 Home" in
search results. The icons are stripped once the search plugin has written its
index; the navigation itself keeps them.
"""

import json
import os


def _labels(items):
    """Yields every label of the nav, sections included."""
    for item in items or []:
        if isinstance(item, dict):
            for label, value in item.items():
                yield label
                if isinstance(value, list):
                    yield from _labels(value)


def _icon_prefixes(nav):
    """Returns the leading "<emoji> " of each label that starts with an icon."""
    prefixes = set()
    for label in _labels(nav):
        icon, _, rest = label.partition(" ")
        if rest and not icon.isascii():
            prefixes.add(icon + " ")
    return prefixes


def on_post_build(config, **kwargs):
    index_path = os.path.join(config["site_dir"], "search", "search_index.json")
    if not os.path.exists(index_path):
        return

    prefixes = _icon_prefixes(config["nav"])
    with open(index_path, encoding="utf-8") as index_file:
        index = json.load(index_file)

    for doc in index.get("docs", []):
        title = doc.get("title", "")
        for prefix in prefixes:
            if title.startswith(prefix):
                doc["title"] = title[len(prefix):]
                break

    with open(index_path, "w", encoding="utf-8") as index_file:
        json.dump(index, index_file, ensure_ascii=False, separators=(",", ":"))
