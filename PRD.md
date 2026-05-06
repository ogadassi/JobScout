# Project Design: JobScout-TS Bot (Enhanced V1.1)

## 1. Project Overview
A TypeScript-based automation tool to aggregate, filter, and track job opportunities. This version is specifically tuned to find **Junior Full-Stack** roles, **Internal Tooling** positions, and **Desktop App Development** opportunities using the Electron/Node.js stack.

---

## 2. Requirements & Characterization
### Core Functional Requirements
* **API-First Search**: Use SerpApi (Google Jobs) to pull listings from LinkedIn, Indeed, and glassdoor without scraping risks.
* **Granular Filtering**: Use a "Score System" for tags. Higher priority given to roles matching the current project stack (Electron/Node.js).
* **Excel Export**: Local `.xlsx` generation with logical columns for manual review.
* **Duplicate Prevention**: Link-based hashing to prevent re-adding the same job in subsequent runs.

### Targeted Search Parameters
* **Location Focus**: Ramat Gan, Tel Aviv, and Remote (Israel).
* **New Niche Targets**: 
    * **Desktop Development**: Searching for "Electron", "Chromium", or "Desktop App" roles.
    * **Internal Tools**: Searching for "Internal Tooling", "Automation Developer", or "IT Automation".
* **Technology "Include" Tags**: 
    * `JavaScript`, `TypeScript`, `Node.js`, `React`, `Electron`, `Docker`, `MySQL`.
* **"Exclude" Tags**: 
    * `Senior`, `Lead`, `Manager`, `Architect`, `Staff`, `Principal`, `5+ years`, `C#`, `Java`.

---

## 3. Required Libraries (TypeScript)
| Library | Purpose |
| :--- | :--- |
| **`axios`** | HTTP requests for SerpApi. |
| **`exceljs`** | Creating and formatting the Excel output. |
| **`dotenv`** | Environment variable management. |
| **`zod`** | Type-safe API response validation. |
| **`typescript`** | Static typing. |
| **`ts-node`** | Direct execution for testing. |

---

## 4. Implementation Task List

### Phase 1: Foundation
- [ ] Initialize project: `npm init -y` and `tsc --init`.
- [ ] Install dependencies: `npm install axios exceljs dotenv zod`.
- [ ] Set up `.env` with `SERPAPI_KEY` and `OUTPUT_PATH`.

### Phase 2: Data Acquisition
- [ ] Create `SerpApiService.ts`.
- [ ] Implement query list:
    * `"Junior Full Stack Developer Israel"`
    * `"Electron Developer"`
    * `"Internal Tools Developer"`
    * `"Node.js Junior Tel Aviv"`.

### Phase 3: The Filter Engine
- [ ] Build `FilterUtility.ts`.
- [ ] Logic: If `title` or `description` contains "Senior" -> Reject.
- [ ] Logic: If `description` contains "Electron" or "Desktop" -> Mark as "High Priority".

### Phase 4: Excel Output
- [ ] Create `ExcelService.ts`.
- [ ] Column Headers: `[Date, Priority, Job Title, Company, Location, Link, Status]`.
- [ ] Implement `checkIfLinkExists` to ensure the Excel sheet only grows with unique roles.

### Phase 5: Automation
- [ ] Create `index.ts` to run the sequence: Fetch -> Filter -> Write.
- [ ] Add summary logging: "Scanned 100 jobs -> 12 matches found -> 5 new roles added."