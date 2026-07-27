# Listner Product Requirements Document (PRD)
**Version:** 2.0 (Astryx Editorial & Intelligent Workflow Release)  
**Status:** Live on Testing & MVP Environments  

---

## 1. Executive Summary & Vision
**Listner** is a next-generation AI audio capture and project synthesis platform designed for effortless thought capture, automated structuring, and high-value conversational refinement. By blending low-friction voice recording with background orchestration, Listner transforms fragmented daily thoughts, geolocated notes, and ongoing observations into structured, cohesive projects.

---

## 2. Core Product Risk Framework & Mitigations
In alignment with advanced product development standards, Listner is continually evaluated and optimized against **Four Core Product Risks**:

### A. Value Risk *(Will users find genuine utility in the AI synthesis and project workflows?)*
- **Mitigation:** Dynamic Content Evolution. Projects no longer remain static after initial creation. When new audio notes are assigned to an existing project, the system automatically refreshes project timestamps, bullet points, titles, and executive summaries.
- **Source Transparency:** Users are empowered to navigate directly from synthesized insights back to the underlying raw audio transcripts and location tags via an approachable, non-technical interface ("Inspect trail").

### B. Usability Risk *(Can users interact effortlessly without cognitive overload or design clutter?)*
- **Mitigation:** Strict Astryx Design System Compliance & Editorial Simplicity. 
- **Zero-Emoji Rule:** All AI generated content and UI elements strictly eliminate emojis in favor of mature, professional typography and iconography.
- **Eliminating Excessive Pill-Boxing:** Transformed bloated pill containers in location rosters and summary lists into clean, edge-to-edge typography lists that preserve vertical screen estate.
- **High-Contrast Dark Mode & Chat:** User chat message bubbles utilize dynamic CSS variable tokens (`--color-bg-user-bubble` and `--color-text-user-bubble`), ensuring crisp legibility across both Dark Mode (dark text on luminous gray) and Light Mode (white text on deep charcoal).

### C. Feasibility Risk *(Can the underlying engineering stack reliably support synchronous UX and asynchronous AI orchestration?)*
- **Mitigation:** Decoupled Architecture. Immediate client-side capture works seamlessly in React/Vite, while heavy AI synthesis (transcription, categorizing, RAG embeddings, and Orchestrator proposal generation) runs asynchronously on secure Firebase Cloud Functions and Cloud Firestore.

### D. Viability & Strategic Risk *(Does the application communicate professional precision and reliability?)*
- **Mitigation:** Human-Centric Communication. Removed intimidating technical terminology (such as "RAG GROUNDING", "Strategic RAG insights", and "RAG audit trail"). Replaced code-level JSON dumps in meeting summaries with clean, structured editorial previews ("Meeting Insights & Updates").

---

## 3. Key Feature Specifications (Latest Release)

### 3.1 Capturing Thoughts & Geolocation Intelligence
- **One-Tap Voice Capture:** Rapid voice-to-text recording integrated with geolocation tagging.
- **Smart Location Verification:** Places and coordinates are cleanly linked and surfaced in compact vertical lists without compromising readability or overloading interface padding.

### 3.2 Intelligent Project Synthesis & RAG Trail
- **Approachable Copy:** 
  - Section headers are humanized: **"Take aways, insights & opportunities"** and **"Inspect trail"**.
  - Direct linking between raw captured notes and derived executive summaries allows seamless validation of AI deductions.

### 3.3 Crisper, Plain-Text Expert Consultations
- **Conversational Brevity:** AI Project Consultants are tuned to deliver crisp, direct, and conversational responses without unnecessary fluff, unless explicitly prompted for lengthy breakdowns.
- **Plain-Text Formatting:** All responses in the consultation interface strip out markdown formatting (asterisks, bolding, bullet syntax) to ensure natural speech compatibility and visual cleanliness.

### 3.4 Editorial Meeting Summary & Proposal Closure
- **Structured Overview:** When concluding an expert meeting, users no longer encounter raw JSON proposals. Instead, they receive an elegant, vertically stacked editorial preview containing:
  - **Proposed Project Title**
  - **Updated Executive Summary**
  - **Where You Left Off**
  - **Refreshed Content Preview & Key Takeaways**
- **Action-Oriented Controls:** Clear, reassuring interaction via **"Update Project"** (Primary Button) and **"Discard Proposals"** (Ghost Button).

---

## 4. Technical Architecture & Design Tokens
- **Frontend Stack:** React 19 + TypeScript + Vite + `@astryxdesign/ui` / `@astryxdesign/theme-neutral`.
- **Backend Stack:** Firebase Authentication, Cloud Firestore, Cloud Storage, and Cloud Functions (Node.js/TS).
- **Design Token Governance:** All UI components consume standard Astryx `--color-*`, `--spacing-*`, and `--radius-*` CSS variables, guaranteeing zero hardcoded hex colors and seamless theme switching.

---

## 5. Changelog & Recent Updates

### [v2.0.0] - 2026-07-27 (Astryx Editorial UI, Dark Mode & Conversational Intelligence)
- **Editorial Meeting Summary Transformation:** Replaced raw JSON code previews in post-consultation screens with a structured, magazine-quality editorial interface ("Meeting Insights & Updates"). Fixed line breaking and header stacking with vertical flex layouts and crisp action controls ("Update Project" vs "Discard Proposals").
- **Dark & Light Mode Chat Contrast Fix:** Resolved unreadable user message bubble backgrounds during expert meetings by creating responsive CSS custom tokens (`--color-bg-user-bubble` & `--color-text-user-bubble`) in `src/index.css` that dynamically invert across theme modes.
- **Crisper, Plain-Text Expert Consultations:** Updated system prompt architecture for the AI Project Consultant to enforce brief, conversational replies in clean plain text, stripping out excessive markdown formatting and lengthy text walls.
- **Human-Centric Copy & RAG Transparency:** Replaced intimidating technical terms ("RAG GROUNDING", "Strategic RAG insights", "RAG audit trail") with approachable headings ("Take aways, insights & opportunities", "Inspect trail"). Maintained seamless navigation between executive synthesis and raw recorded source notes.
- **Zero-Emoji & Pill-Box Clutter Reduction:** Removed informal emojis across UI and AI outputs. Replaced bulky pill containers on location lists and bullet items with clean, edge-to-edge text lists, maximizing vertical screen real estate.

### [v1.9.0] - 2026-07-26 (Orchestrator Resilience & Frontend Self-Healing)
- **Firestore Security Rule Compliance:** Updated frontend self-healing note queries with explicit User ID (`uid`) indexing to conform to strict Firestore database security policies.
- **Fault-Tolerant Note Binding:** Hardened Cloud Functions Orchestrator against deleted notes and enforced authoritative note ID validation during automated project formation.
- **Precision Summaries:** Refined automated project summaries to deliver punchy, 10-12 word synopses accompanied by concrete descriptions of recent activity in "Where You Left Off".
- **Orchestrator Status Badging:** Introduced clean status indicators across capture and project views, informing users when the AI consultant is actively synthesizing newly captured notes in the background.
