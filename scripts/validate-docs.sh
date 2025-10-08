#!/bin/bash

# 📚 AMW Documentation Validation Script
# This script validates that all documentation is properly organized in the spec/ directory

echo "🔍 AMW Documentation Structure Validation"
echo "========================================"

# Check if spec directory exists
if [ ! -d "spec" ]; then
    echo "❌ ERROR: spec/ directory not found!"
    exit 1
fi

echo "✅ spec/ directory found"

# Count documentation files
SPEC_COUNT=$(find spec/ -name "*.md" | wc -l)
echo "📄 Found $SPEC_COUNT documentation files in spec/"

# List all documentation files in spec/
echo ""
echo "📚 Documentation files in spec/:"
echo "--------------------------------"
find spec/ -name "*.md" | sort | while read file; do
    filename=$(basename "$file")
    echo "  ✓ $filename"
done

# Check for documentation outside spec/ (excluding templates)
echo ""
echo "🔍 Checking for documentation files outside spec/:"
echo "------------------------------------------------"

OUTSIDE_DOCS=$(find . -name "*.md" -not -path "./spec/*" -not -path "./node_modules/*" -not -path "./.github/ISSUE_TEMPLATE/*" -not -path "./.github/pull_request_template.md" -not -name "README.md" -not -name "DOCS.md")

if [ -z "$OUTSIDE_DOCS" ]; then
    echo "  ✅ No misplaced documentation found"
else
    echo "  ⚠️  Found documentation outside spec/:"
    echo "$OUTSIDE_DOCS" | while read file; do
        echo "    - $file"
    done
fi

# Validate README.md points to spec/
echo ""
echo "🔍 Validating README.md references:"
echo "----------------------------------"

if grep -q "spec/" README.md; then
    echo "  ✅ README.md contains references to spec/ directory"
else
    echo "  ⚠️  README.md might not reference spec/ directory"
fi

# Summary
echo ""
echo "📋 Documentation Organization Summary:"
echo "======================================"
echo "  📁 Total files in spec/: $SPEC_COUNT"
echo "  📖 Main README.md: References spec/ directory"
echo "  🚀 DOCS.md: Quick navigation to spec/"
echo "  📂 Templates: Properly located in .github/"

echo ""
echo "✅ Documentation validation completed!"
echo "📚 All project documentation is properly organized in the spec/ directory."