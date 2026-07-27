"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.synthesizeSpeech = exports.orchestrateNotes = exports.onNoteCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_2 = require("firebase-admin/firestore");
const genai_1 = require("@google/genai");
const text_to_speech_1 = __importDefault(require("@google-cloud/text-to-speech"));
admin.initializeApp();
const db = (0, firestore_2.getFirestore)();
let aiInstance = null;
function getAI() {
    if (!aiInstance) {
        aiInstance = new genai_1.GoogleGenAI({
            project: process.env.GCLOUD_PROJECT || "listner-mvp-justus",
            location: "us",
            vertexai: true
        });
    }
    return aiInstance;
}
exports.onNoteCreated = (0, firestore_1.onDocumentCreated)("notes/{noteId}", async (event) => {
    const snapshot = event.data;
    if (!snapshot)
        return;
    const data = snapshot.data();
    if (data.embedding)
        return; // Already has embedding
    const textToEmbed = `${data.metadata || ''}\nNote: ${data.text}`;
    try {
        const ai = getAI();
        const response = await ai.models.embedContent({
            model: 'text-embedding-004',
            contents: textToEmbed,
        });
        if (response.embeddings && response.embeddings[0].values) {
            const vector = firestore_2.FieldValue.vector(response.embeddings[0].values);
            await snapshot.ref.update({ embedding: vector });
        }
    }
    catch (err) {
        console.error("Error generating embedding", err);
    }
});
exports.orchestrateNotes = (0, https_1.onCall)(async (request) => {
    const uid = request.auth?.uid;
    if (!uid) {
        throw new Error("Unauthenticated");
    }
    const { action, noteIds, targetProjectId } = request.data;
    let targetNoteIds = [];
    let isManualAppend = false;
    if (action === 'manual' || action === 'append_to_existing' || action === 'manual_append') {
        if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
            throw new Error("Invalid payload for manual action");
        }
        targetNoteIds = noteIds;
        if (action === 'append_to_existing' || action === 'manual_append') {
            if (!targetProjectId) {
                throw new Error("Target project ID required for appending");
            }
            isManualAppend = true;
        }
    }
    else if (action === 'auto') {
        // Auto mode: fetch all unassigned notes, sort by newest, take top 5
        const unassignedSnap = await db.collection('notes')
            .where('uid', '==', uid)
            .where('projectId', '==', null)
            .get();
        if (unassignedSnap.empty) {
            return { status: 'idle' };
        }
        const docs = unassignedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        docs.sort((a, b) => {
            const timeA = a.createdAt?.toMillis() || 0;
            const timeB = b.createdAt?.toMillis() || 0;
            return timeB - timeA;
        });
        // Take top 5 most recent unassigned notes
        targetNoteIds = docs.slice(0, 5).map((d) => d.id);
    }
    else {
        throw new Error("Invalid action");
    }
    // Fetch the selected notes
    const notesPromises = targetNoteIds.map(id => db.collection('notes').doc(id).get());
    const notesSnaps = await Promise.all(notesPromises);
    let notesContext = "";
    for (const snap of notesSnaps) {
        if (snap.exists && snap.data()?.uid === uid) {
            const data = snap.data();
            const dateStr = data.createdAt?.toDate ? data.createdAt.toDate().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : (data.createdAt ? String(data.createdAt) : 'Recent');
            const locStr = data.locationString ? ` [Location: ${data.locationString}]` : '';
            notesContext += `[ID: ${snap.id}] [Date/Time: ${dateStr}]${locStr} [Category: ${data.category}] ${data.metadata ? '[' + data.metadata + '] ' : ''}${data.text}\n`;
        }
    }
    if (!notesContext) {
        throw new Error("No valid notes found.");
    }
    // Fetch user's existing active projects to enable conservative sorting and manual appending
    const projectsSnap = await db.collection('projects')
        .where('uid', '==', uid)
        .get();
    let existingProjectsContext = "None";
    const existingProjectsMap = new Map();
    if (!projectsSnap.empty) {
        projectsSnap.docs.forEach((doc) => {
            existingProjectsMap.set(doc.id, { ref: doc.ref, data: doc.data() });
        });
        const activeDocs = projectsSnap.docs.filter((doc) => doc.data().status !== 'proposed');
        if (activeDocs.length > 0) {
            existingProjectsContext = activeDocs.map((doc) => {
                const d = doc.data();
                return `[ProjectID: ${doc.id}] [Title: "${d.title}"] [Archetype: ${d.archetype || 'Diary'}] [Summary: "${d.summary || d.shortSummary || ''}"] [MetaAnalysis: ${JSON.stringify(d.metaAnalysis || {})}]`;
            }).join('\n');
        }
    }
    if (isManualAppend && !existingProjectsMap.has(targetProjectId)) {
        throw new Error("Target project not found");
    }
    let prompt = "";
    if (isManualAppend) {
        const targetProj = existingProjectsMap.get(targetProjectId).data;
        prompt = `You are an executive AI assistant tasked with merging new user voice notes into an existing project and generating a synthesized meta-analysis.
New Notes to Append:
${notesContext}

Target Project Details:
Title: "${targetProj.title}"
Archetype: "${targetProj.archetype || 'Diary'}"
Current Summary: "${targetProj.summary || ''}"
Current Meta-Analysis: ${JSON.stringify(targetProj.metaAnalysis || {})}

IMPORTANT DESIGN INSTRUCTION: DO NOT generate detailed per-note summaries or repetitive item-by-item log entries that mimic the raw notes. The user already sees their raw voice notes in a separate list. The true value add of the AI is to provide an overarching high-level summary and executive meta-analysis across all notes combined.

Output ONLY raw JSON (no markdown blocks) matching this schema:
{
  "action": "append_to_existing",
  "targetProjectId": "${targetProjectId}",
  "projectDetails": {
    "title": "An evolved, high-level project title. CRITICAL RULE: Do NOT leave old narrow titles untouched! If new notes broaden the overall scope (e.g. going from 2 station notes to 14 vacation notes), generalize and upgrade the title immediately!",
    "archetype": "${targetProj.archetype || 'Diary'}",
    "summary": "EXACTLY ONE short declarative sentence summarizing the overarching project essence in MAXIMUM 10 TO 12 WORDS (e.g. 'Familienurlaub in Stockholm mit Städtetrip und Ferienhaus am See.'). STRICT RULE: Under NO circumstances write bloated compound sentences!",
    "latestChange": "EXACTLY ONE short sentence explicitly stating what specific concrete topic, place, or insight was MOST RECENTLY added so the user instantly remembers where they left off (e.g. 'Zuletzt notiert: Café Panem als idealen Pausenort bewertet.'). STRICT RULE: Do NOT output vague statistics or generic administrative statements!",
    "metaAnalysis": {
      "timespan": "Timespan & scope WITH EXACT CALENDAR DATES and TIMESTAMPS covered by all notes (e.g., '24.07.2026 10:30 – 26.07.2026 18:00 (3 Days) · Schweden-Aufenthalt'). YOU MUST ALWAYS INCLUDE SPECIFIC DATES AND TIMESTAMPS derived from note metadata!",
      "placesVisited": ["List of distinct places, restaurants, cafes, museums, or cities visited or discussed across all notes"],
      "keyTakeaways": ["High-level takeaway, milestone, or overarching theme 1", "Key takeaway 2"],
      "interestingOpportunities": ["Forward-looking idea, suggestion, or interesting opportunity 1", "Opportunity 2"]
    },
    "nextSteps": ["Updated actionable step 1", "Updated actionable step 2"],
    "reasoning": "Manually added and synthesized into existing project meta-analysis",
    "sourceNoteIds": ${JSON.stringify(targetNoteIds)},
    "content": { ... } // MUST MATCH THE ARCHETYPE SCHEMA BELOW
  }
}

Archetype Content Schemas for "projectDetails.content":
- For Diary: { "narrativeOverview": "string (a high-level cohesive storyline connecting the experiences without repetitive station entries)" }
- For Chapters: { "chapters": [{ "heading": "string (topic area or chapter heading)", "body": "string (synthesized overview of this topic)" }] }
- For Brainstorm: { "thesis": "string (refined thesis)", "pros": ["string"], "cons": ["string"], "ideas": ["string (generated opportunities and conceptual extensions)"] }
`;
    }
    else {
        prompt = `You are an executive AI orchestrator that organizes user voice notes into structured Projects and provides strategic meta-analysis.
Given the following new notes from the user:
${notesContext}

Here are the user's EXISTING active projects:
${existingProjectsContext}

Your task is to decide how to process these notes with a STRICT CONSERVATIVE ROUTING BIAS:
CRITICAL RULES & THRESHOLDS:
1. FAVOR EXISTING PROJECTS: Whenever a note is remotely compatible with an existing project, choose "append_to_existing" instead of spawning a brand new project.
2. DIARY & CONTINUOUS LOGS: If an existing project represents a Diary, Journal, or continuing stream of thoughts, ALWAYS prioritize appending new notes to it over creating a new project. Do NOT duplicate Diaries!
3. HIGH BAR FOR NEW PROJECTS: Only set action to "propose_new" if the note introduces a totally novel topic that would make zero sense inside ANY of the existing projects.
4. NO REPETITIVE PER-NOTE SUMMARIES: DO NOT create granular, item-by-item summaries (like 'Station 1', 'Station 2') that duplicate the raw voice notes. Invest in high-level summaries and meta-analysis (timespan, places visited, key takeaways, interesting opportunities).
5. DYNAMIC TITLE & SUMMARY EVOLUTION: Whenever appending to an existing project, you MUST critically check if the existing title has become too narrow or outdated (e.g., if a project initially titled 'Städtetrip Stockholm: Panem & Junibacken' expands to 14 notes including a holiday house and spa, you MUST actively upgrade the title to reflect the broader scope, such as 'Stockholm Städtetrip & Familienurlaub'). ALWAYS regenerate both the summary and latestChange bullets to precisely reflect the new state!

Output ONLY raw JSON (no markdown blocks) with the following schema:
{
  "action": "append_to_existing" | "propose_new" | "ignore",
  "targetProjectId": "Required ONLY if action is append_to_existing (must match an exact ProjectID above)",
  "projectDetails": {
    "title": "An evolved, high-level project title. CRITICAL RULE: Do NOT leave old narrow titles untouched! If new notes broaden the overall scope, generalize and upgrade the title immediately!",
    "archetype": "Diary | Chapters | Brainstorm",
    "summary": "EXACTLY ONE short declarative sentence summarizing the overarching essence across all notes in MAXIMUM 10 TO 12 WORDS. STRICT RULE: Under NO circumstances write bloated compound sentences!",
    "latestChange": "EXACTLY ONE short sentence explicitly stating what specific concrete topic, place, or insight was MOST RECENTLY added or why this project was formed so the user instantly remembers where they left off. STRICT RULE: Do NOT output vague statistics or generic administrative statements!",
    "metaAnalysis": {
      "timespan": "Timespan & scope WITH EXACT CALENDAR DATES and TIMESTAMPS covered by notes (e.g., '24.07.2026 14:00 – 25.07.2026 19:30 · Stockholm-Ausflug'). YOU MUST ALWAYS INCLUDE SPECIFIC DATES AND TIMESTAMPS!",
      "placesVisited": ["List of distinct locations, venues, or cities mentioned in the notes or metadata"],
      "keyTakeaways": ["High-level takeaway, theme, or major conclusion 1", "Takeaway 2"],
      "interestingOpportunities": ["Forward-looking activity, strategic connection, or interesting opportunity 1", "Opportunity 2"]
    },
    "nextSteps": ["Actionable step 1", "Actionable step 2"],
    "reasoning": "Why you sorted these notes into an existing project or proposed a new one",
    "sourceNoteIds": ${JSON.stringify(targetNoteIds)},
    "content": { ... } // MUST MATCH ONE OF THE ARCHETYPE SCHEMAS BELOW
  }
}

Archetype Content Schemas for "projectDetails.content":
- For Diary: { "narrativeOverview": "string (a high-level cohesive storyline connecting the experiences without repetitive station entries)" }
- For Chapters: { "chapters": [{ "heading": "string (topic area)", "body": "string (synthesized prose/content)" }] }
- For Brainstorm: { "thesis": "string (core thesis)", "pros": ["string"], "cons": ["string"], "ideas": ["string"] }
`;
    }
    const ai = getAI();
    const result = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: prompt
    });
    const fullText = result.text || "";
    const jsonMatch = fullText.match(/```json\n?([\s\S]*?)\n?```/);
    const jsonString = jsonMatch ? jsonMatch[1].trim() : fullText.replace(/```json\n?|\n?```/g, '').trim();
    try {
        const parsed = JSON.parse(jsonString);
        if (parsed.action === 'append_to_existing' && parsed.targetProjectId && existingProjectsMap.has(parsed.targetProjectId)) {
            const { ref, data: existingData } = existingProjectsMap.get(parsed.targetProjectId);
            const newDetails = parsed.projectDetails || {};
            // Merge content based on archetype
            let mergedContent = existingData.content || {};
            const archetype = existingData.archetype || newDetails.archetype || 'Diary';
            if (archetype === 'Diary') {
                mergedContent = {
                    ...mergedContent,
                    narrativeOverview: newDetails.content?.narrativeOverview || mergedContent.narrativeOverview || newDetails.summary || ''
                };
                // Eliminate legacy redundant entries array to prevent UI clutter
                delete mergedContent.entries;
            }
            else if (archetype === 'Chapters') {
                const oldChapters = Array.isArray(mergedContent.chapters) ? mergedContent.chapters : [];
                const newChapters = Array.isArray(newDetails.content?.chapters) ? newDetails.content.chapters : [];
                mergedContent = { ...mergedContent, chapters: [...oldChapters, ...newChapters] };
            }
            else if (archetype === 'Brainstorm') {
                const oldIdeas = Array.isArray(mergedContent.ideas) ? mergedContent.ideas : [];
                const newIdeas = Array.isArray(newDetails.content?.ideas) ? newDetails.content.ideas : [];
                mergedContent = {
                    ...mergedContent,
                    thesis: newDetails.content?.thesis || mergedContent.thesis || '',
                    ideas: [...oldIdeas, ...newIdeas],
                    pros: [...(mergedContent.pros || []), ...(newDetails.content?.pros || [])],
                    cons: [...(mergedContent.cons || []), ...(newDetails.content?.cons || [])],
                };
            }
            const oldSourceIds = Array.isArray(existingData.sourceNoteIds) ? existingData.sourceNoteIds : [];
            const updatedSourceIds = Array.from(new Set([...oldSourceIds, ...targetNoteIds]));
            const oldMeta = existingData.metaAnalysis || {};
            const newMeta = newDetails.metaAnalysis || {};
            const mergedMeta = {
                ...oldMeta,
                ...newMeta,
                placesVisited: Array.from(new Set([...(Array.isArray(oldMeta.placesVisited) ? oldMeta.placesVisited : []), ...(Array.isArray(newMeta.placesVisited) ? newMeta.placesVisited : [])])),
                keyTakeaways: Array.from(new Set([...(Array.isArray(newMeta.keyTakeaways) ? newMeta.keyTakeaways : []), ...(Array.isArray(oldMeta.keyTakeaways) ? oldMeta.keyTakeaways : [])])),
                interestingOpportunities: Array.from(new Set([...(Array.isArray(newMeta.interestingOpportunities) ? newMeta.interestingOpportunities : []), ...(Array.isArray(oldMeta.interestingOpportunities) ? oldMeta.interestingOpportunities : [])]))
            };
            await ref.update({
                title: newDetails.title || existingData.title || 'Untitled Project',
                content: mergedContent,
                metaAnalysis: mergedMeta,
                sourceNoteIds: updatedSourceIds,
                summary: newDetails.summary || existingData.summary || '',
                latestChange: newDetails.latestChange || 'Updated project with new voice captures.',
                nextSteps: newDetails.nextSteps || existingData.nextSteps || [],
                updatedAt: firestore_2.FieldValue.serverTimestamp()
            });
            // Update all selected notes to belong to this existing project
            const batch = db.batch();
            for (const id of targetNoteIds) {
                batch.update(db.collection('notes').doc(id), { projectId: ref.id });
            }
            await batch.commit();
            return { status: 'appended', projectId: ref.id };
        }
        else if (parsed.action === 'propose_new' || parsed.action === 'propose') {
            const newProjectRef = await db.collection('projects').add({
                ...(parsed.projectDetails || {}),
                latestChange: parsed.projectDetails?.latestChange || 'Proposed new project structure from recent voice captures.',
                sourceNoteIds: Array.isArray(targetNoteIds) && targetNoteIds.length > 0 ? targetNoteIds : (parsed.projectDetails?.sourceNoteIds || []),
                uid,
                status: 'proposed', // The Gatekeeper Model: do NOT auto-create as active/draft!
                createdAt: firestore_2.FieldValue.serverTimestamp()
            });
            // We explicitly DO NOT overwrite note projectId yet! We preserve source notes in memory until approved.
            return { status: 'proposed', projectId: newProjectRef.id };
        }
    }
    catch (e) {
        console.error("Failed to parse JSON or update project", e);
    }
    return { status: 'ignored' };
});
const ttsClient = new text_to_speech_1.default.TextToSpeechClient();
exports.synthesizeSpeech = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error("Unauthenticated");
    }
    const text = request.data.text;
    if (!text) {
        throw new Error("Missing text");
    }
    try {
        const [response] = await ttsClient.synthesizeSpeech({
            input: { text: text },
            voice: { languageCode: 'en-US', name: 'en-US-Journey-F' },
            audioConfig: { audioEncoding: 'MP3' },
        });
        return {
            audioContent: response.audioContent ? Buffer.from(response.audioContent).toString('base64') : null
        };
    }
    catch (error) {
        console.error("TTS error", error);
        throw new Error("TTS failed");
    }
});
//# sourceMappingURL=index.js.map