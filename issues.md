# User Impact & Issues Report - EmailMaster

This document details the issues discovered through live browser testing and their impact on the user experience.

## 1. UX & Interaction Issues
- **Unreliable Database Search**: 
    - The search input occasionally glitches if users type quickly, leading to concatenated search terms (e.g., "gmailgmail") which results in "No emails found."
    - There is no "Clear Search" button, forcing users to manually delete their query to see all results again.
- **Lack of Processing Feedback**: 
    - While the "Process & Filter" button shows a spinner, there is no success message or automatic scroll to the results. On large monitors, users might not realize the stats at the top have updated.
- **Master Block List Management**: 
    - Users can add domains to the Block List via a textarea, but there is no way to remove them individually within that specific tab (they must edit the text manually). This is inconsistent with the "Keywords" and "TLDs" settings which have "x" buttons for removal.

## 2. Visual & UI Gaps
- **Sidebar Disconnect**: The "Reset Tool" button is positioned at the absolute bottom of the sidebar, separated from the main navigation by a massive empty space. This makes it look like it's not part of the same application.
- **Total vs. Filtered Stats**: When a search is applied in the Database tab, the "Total Emails" badge continues to show the *global* total, which can be confusing when the table is empty or showing only a few matches.
- **Alignment Issues**: Table headers and row data occasionally exhibit minor misalignment depending on the browser window width, making data scanability slightly harder.

## 3. Real-World Performance Impact
- **Search Lag**: Without debouncing on the `oninput` event, searching through a database of even 100+ items causes a noticeable stutter in the UI.
- **Bulk Operations**: Marking a whole batch as sent is a single click, but there is no "Batch Undo." If a user clicks it by mistake, they must go to the database or results table and manually unmark each one, which is highly tedious.
