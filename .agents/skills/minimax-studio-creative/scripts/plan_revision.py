"""Show which approved assets can be reused after changes to a creative project."""

import argparse
from graphlib import CycleError, TopologicalSorter
import json
from pathlib import Path
import sys


def plan_revision(project, changed_ids):
    if not isinstance(project, dict) or type(project.get("version")) is not int or project["version"] != 1:
        raise ValueError("manifest version must be 1")
    items = project.get("items")
    if not isinstance(items, list) or not items:
        raise ValueError("manifest must contain project items")

    dependencies = {}
    for item in items:
        identifier = item.get("id") if isinstance(item, dict) else None
        if not isinstance(identifier, str) or not identifier.strip() or identifier in dependencies:
            raise ValueError("each project item must have a unique non-empty ID")
        parents = item.get("depends_on", [])
        if not isinstance(parents, list) or any(not isinstance(parent, str) for parent in parents):
            raise ValueError(f"{identifier}: depends_on must be a list of item IDs")
        dependencies[identifier] = parents

    for identifier, parents in dependencies.items():
        for parent in parents:
            if parent not in dependencies:
                raise ValueError(f"{identifier}: unknown dependency {parent!r}")

    changed = set(changed_ids)
    if not changed:
        raise ValueError("provide at least one item ID to revise")
    unknown = changed.difference(dependencies)
    if unknown:
        raise ValueError(f"unknown revision item IDs: {', '.join(sorted(unknown))}")
    try:
        order = list(TopologicalSorter(dependencies).static_order())
    except CycleError as error:
        raise ValueError("manifest dependencies form a cycle") from error

    impacted = set(changed)
    for identifier in order:
        if impacted.intersection(dependencies[identifier]):
            impacted.add(identifier)

    dependents = impacted - changed
    return {
        "revise": [identifier for identifier in order if identifier in changed],
        "review_dependents": [identifier for identifier in order if identifier in dependents],
        "reuse_approved": [item["id"] for item in items if item.get("status") == "approved" and item["id"] not in impacted],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("item_ids", nargs="+")
    args = parser.parse_args()
    try:
        with args.manifest.open(encoding="utf-8") as source:
            result = plan_revision(json.load(source), args.item_ids)
    except (OSError, ValueError) as error:
        print(f"Cannot plan revision: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
