#!/usr/bin/env python3
"""
Analyze import errors from the legacy inbound scans import.
Shows summary of error types and missing users.
"""

import json
from collections import Counter

# Load error log
with open('import_errors.json', 'r') as f:
    errors = json.load(f)

print("=" * 80)
print("Import Errors Analysis")
print("=" * 80)
print(f"\nTotal Errors: {len(errors)}\n")

# Count error types
error_types = Counter()
missing_users = Counter()

for error in errors:
    error_msg = error.get('error', '')
    error_types[error_msg.split(':')[0]] += 1
    
    if 'User not found' in error_msg:
        user_name = error_msg.split(': ')[1]
        missing_users[user_name] += 1

print("Error Types:")
print("-" * 80)
for error_type, count in error_types.most_common():
    print(f"  {error_type}: {count}")

print("\n\nMissing Users (Top 20):")
print("-" * 80)
for user, count in missing_users.most_common(20):
    print(f"  {user}: {count} records")

print("\n" + "=" * 80)
