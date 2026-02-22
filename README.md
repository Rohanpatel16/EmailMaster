# EmailMaster: Professional Lead Filtering & Batching Tool

EmailMaster is a high-performance, browser-based tool designed for lead generation specialists and outreach teams. It allows you to extract, filter, and organize thousands of emails into manageable batches without ever sending your data to a server.

## 🚀 Key Features

- **Smart Email Extraction**: Automatically cleans emails of common "junk" artifacts like leading hyphens (`-`) or trailing dots (`.com.`).
- **Advanced Filtering**: 
    - Master Block List for specific domains.
    - Keyword-based exclusion (e.g., "consultancy", "hr", "jobs").
    - TLD exclusion (e.g., `.edu`, `.ac.in`).
    - Smart Allow List (Exceptions) to override filters for specific high-value domains.
- **Batch Processing**: Organize leads into custom-sized batches (e.g., 25, 50, 100) with a horizontal scrollable UI.
- **Sent Tracking & Cooldowns**: Mark leads as "Sent" with customizable cooldown periods (1 Week to 1 Year) to avoid duplicate outreach.
- **Database Explorer**: A unified, searchable view of your entire outreach history across all projects.
- **Bulk Export**: Export your deduplicated leads or historical data as `.csv` or `.txt` files.
- **Privacy First**: 100% client-side. Data stays in your browser's IndexedDB.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Glassmorphism UI), JavaScript (ES6+)
- **Storage**: IndexedDB (Native Browser Database) for persistence
- **Icons**: Font Awesome 6.0

## 📦 Getting Started

1. **Paste**: Paste your raw scraped text into the input area.
2. **Filter**: Set your batch size and cooldown period.
3. **Copy & Mark**: Copy a batch, paste it into your email sender, and click "Mark as Sent".
4. **Manage**: Use the "Database" tab to view history or export your list for backup.

---

## 🛡 License

MIT License - feel free to use and modify for your own projects.
