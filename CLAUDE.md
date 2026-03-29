# CLAUDE.md — Wu Browser

## Runtime Safety Gates

### Gate 1: Process Safety
If a change introduces exec() / spawn() / child_process:
- Must have process.on('exit') or try-finally cleanup
- Must track PID via trackedProcesses Map
- Missing cleanup → do not commit, fix first

### Gate 2: Browser Launch Safety (Connect-First)
If a change involves browser launch:
- Must call connectOrLaunch(), not launchChrome() directly
- Must check resource budget (getAvailableMemoryMB)
- Must NOT use --user-data-dir unless WU_BROWSER_PROFILE env var is set
- Launching a second Chrome instance is a bug, not a feature

### Gate 3: Test/Benchmark Teardown
If a change involves test suites or benchmarks:
- Must have afterAll/teardown that cleans all resources
- Must verify no zombie processes after teardown
- Benchmarks run sequentially, not in parallel

## Design Principles

- **Connect-First**: Detect existing Chrome → connect. Only launch if none found.
- **Resource Budget**: Check system memory before any resource-heavy operation. Refuse if insufficient.
- **Cleanup-as-Contract**: Every opened resource has a structural cleanup guarantee (try-finally / process.on), not a "remember to close" comment.
- **No user-data-dir by default**: User's Chrome has login sessions. A new profile = double memory + lost sessions.
