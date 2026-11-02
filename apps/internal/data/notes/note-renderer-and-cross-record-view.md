---
visibility: private
id: note-renderer-and-cross-record-view
title: Separate a record’s renderer from a view spanning records
related_notes:
  - note-one-source-many-encounters
  - note-protocol-versus-interface-rules
  - note-staged-encounter-layers
written_when:
  label: 'Writing date unknown; source-file label(s): 2026-08-24'
  certainty: unknown
  precision: unknown
  basis: >-
    The combined inbox uses source-file last-modified labels. They identify the
    source context, not when these thoughts were written. No writing date or
    upper bound is inferred.
sources:
  - file: /Users/timbutler/Projects/astrogenesis/private/inbox.md
    sha256: 1d915010cda2ba4f74781aeac6b4ed74de5b4d9ed99d6f124dbf67692b73e500
    section: ~/zero-arch/temp/inbox.md (2026-08-24)
    start_line: 1183
    end_line: 1183
    kind: inbox
created_at: '2026-11-02T15:29:36.911Z'
---

A renderer changes how a particular record or type is presented. A view can combine records to answer a question that no single entity answers on its own.

Keeping these concerns separate allows an interface to improve without changing what the underlying records are.

## Related notes

- [One source can support many ways of encountering it](./note-one-source-many-encounters.md)
- [Interface conventions should not become protocol invariants by accident](./note-protocol-versus-interface-rules.md)
- [Let a visitor move from an initial encounter to views and detail](./note-staged-encounter-layers.md)
