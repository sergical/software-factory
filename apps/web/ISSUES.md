# Seeded issues for the factory

The todo app lives in `apps/web` of this repository; paths are repo-relative.

Note: issue 5 below has an intentionally flaky test, `apps/web/src/lib/id.test.ts` > `generates unique ids`. The id generator combines the current millisecond with a random 0-99 suffix, so generating 10 ids in a tight loop occasionally collides. This is by design and should stay flaky until the underlying bug is fixed.

## 1. Whitespace-only todos can be added
**Labels:** factory
If I type only spaces into the new todo box and hit Add, it still adds an item to the list. Steps: open the app, type "   " (spaces only) into the input, click Add. Expected: nothing is added, and the input stays focused so I can type a real todo. Instead I get a blank-looking row in my list.

## 2. Remaining count is not pluralised
**Labels:** factory
The footer always says things like "1 items left" instead of "1 item left". Steps: add one todo and leave it unchecked. Expected: the text reads "1 item left" when there is exactly one, and "N items left" otherwise.

## 3. "Completed" filter shows the wrong todos
**Labels:** factory
Switching the filter to "completed" shows my unfinished todos instead of the ones I checked off. Steps: add two todos, complete one of them, click the "completed" filter tab. Expected: only the completed todo shows up. Instead I see the one that is still active.

## 4. "Clear completed" deletes everything except completed todos
**Labels:** factory
Clicking "Clear completed" is supposed to remove the todos I've finished, but instead it removes all my unfinished ones and leaves the completed ones behind. Steps: add two todos, complete one, click "Clear completed". Expected: the completed todo disappears and the active one stays.

## 5. Duplicate ids cause the wrong todo to toggle
**Labels:** factory
Occasionally, checking off one todo checks a different one instead, or two todos seem to share state. This happens when two todos get created with the same id. The generator is in `apps/web/src/lib/id.ts`; it builds ids from the current millisecond plus a random 0-99 suffix, so two todos added in quick succession can collide. Please make ids reliably unique.

## 6. Todos are not saved between visits
**Labels:** factory
If I refresh the page or close the tab, my whole todo list is gone. Steps: add a few todos, reload the page. Expected: the list is restored from where I left off. Please persist todos in `localStorage` under the key `todos` and load them back in on startup.
