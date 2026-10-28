# AGENTS.md

## Rules

- All tests must be written in TypeScript - never use JavaScript
- Features without tests are incomplete - every new feature or bug fix needs test coverage
- Don't skip tests due to type issues - fix the types instead
- Test both success and failure cases with edge cases
- Keep added tests as minimal and dense as possible without sacrificing comprehensiveness; avoid redundant assertions or broad fixtures when a focused case proves the behavior.
- No log statements (`console.log`, `debugger`) in tests or production code
- Keep comments SHORT AND TIGHT — one lowercase sentence fragment, one clause, no trailing period. Never a capitalized full sentence, and never two of them. Extreme concision: say only what the code cannot say, and cut the setup sentence, the recap, and the same point restated in different words; a comment that needs three sentences usually means the code should be clearer. Identifiers keep their real casing (`Error`, `parse()`), only the prose is lowercase.
- Ask before generating new files
- Avoid circular dependencies
- Performance is critical - parameter reassignment is allowed for optimization
- Keep JSDoc as minimal as possible. A self-explanatory type or symbol name needs no doc comment.
- When you've modified a PR (or opened/closed/commented on one), include the PR URL liberally in summary messages — at minimum once at the end of any reply that touched it
- When creating a PR, do not include a separate test plan section in the body. Link to any relevant issues under discussion, and use the same copywriting guidelines from "Commenting on issues and PRs": concise maintainer voice, prose over templates, and validation details only when they are material to the reader.

## Git

- Conventional commits.
- Branch off `main` first. Never commit straight to `main`.
- Commit only after the task is complete and its tests pass.
- Group related files for commits based on the changes done instead of committing everything once. 
- Stage explicit paths only (never `git add -A`) so unrelated dirty work is not swept in.
