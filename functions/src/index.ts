import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { GoogleGenAI } from "@google/genai";

admin.initializeApp();
const db = admin.firestore();

let aiInstance: GoogleGenAI | null = null;
function getAI() {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      project: process.env.GCLOUD_PROJECT || "listner-mvp-justus",
      location: "us",
      vertexai: true
    } as any);
  }
  return aiInstance;
}

export const onNoteCreated = onDocumentCreated("notes/{noteId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) return;

  const data = snapshot.data();
  if (data.embedding) return; // Already has embedding

  const textToEmbed = `${data.metadata || ''}\nNote: ${data.text}`;
  
  try {
    const ai = getAI();
    const response = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: textToEmbed,
    });
    
    if (response.embeddings && response.embeddings[0].values) {
      const vector = FieldValue.vector(response.embeddings[0].values);
      await snapshot.ref.update({ embedding: vector });
    }
  } catch (err) {
    console.error("Error generating embedding", err);
  }
});

export const orchestrateNotes = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new Error("Unauthenticated");
  }

  const { action, noteIds } = request.data as any;
  let targetNoteIds: string[] = [];

  if (action === 'manual') {
    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      throw new Error("Invalid payload for manual action");
    }
    targetNoteIds = noteIds;
  } else if (action === 'auto') {
    // Auto mode: fetch all unassigned notes, sort by newest, take top 5
    const unassignedSnap = await db.collection('notes')
      .where('uid', '==', uid)
      .where('projectId', '==', null)
      .get();
      
    if (unassignedSnap.empty) {
      return { status: 'idle' };
    }
    
    const docs = unassignedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    docs.sort((a: any, b: any) => {
      const timeA = a.createdAt?.toMillis() || 0;
      const timeB = b.createdAt?.toMillis() || 0;
      return timeB - timeA;
    });
    
    // Take top 5 most recent unassigned notes
    targetNoteIds = docs.slice(0, 5).map(d => d.id);
  } else {
    throw new Error("Invalid action");
  }

  // Fetch the selected notes
  const notesPromises = targetNoteIds.map(id => db.collection('notes').doc(id).get());
  const notesSnaps = await Promise.all(notesPromises);

  
  let notesContext = "";
  for (const snap of notesSnaps) {
    if (snap.exists && snap.data()?.uid === uid) {
      const data = snap.data()!;
      notesContext += `[ID: ${snap.id}] [Category: ${data.category}] ${data.metadata ? '['+data.metadata+'] ' : ''}${data.text}\n`;
    }
  }

  if (!notesContext) {
    throw new Error("No valid notes found.");
  }

  const prompt = `You are an AI orchestrator that organizes user voice notes into structured Projects.
Given the following highly-relevant notes from the user:
${notesContext}

Your task is to synthesize these notes into a structured Project. You must categorize the project into one of 3 precise archetypes: "Diary", "Chapters", or "Brainstorm".

CRITICAL INSTRUCTION: You must choose the MOST APPROPRIATE structural archetype based on the content of the notes.
- If the user is talking about a sequence of events or personal thoughts over time, use "Diary".
- If the user is writing long-form structured content like a book, article, or PRD, use "Chapters".
- If the user is capturing, organizing, and weighing scattered ideas around a central topic or thesis, use "Brainstorm".

Output ONLY raw JSON (no markdown blocks) with the following schema:
{
  "action": "propose" | "ignore",
  "projectDetails": {
    "title": "A short, descriptive title",
    "archetype": "Diary | Chapters | Brainstorm",
    "summary": "A high-level summary of the project",
    "nextSteps": ["Actionable step 1", "Actionable step 2"],
    "reasoning": "Why you grouped these notes together",
    "sourceNoteIds": ${JSON.stringify(targetNoteIds)},
    "content": { ... } // MUST MATCH ONE OF THE ARCHETYPE SCHEMAS BELOW
  }
}

Archetype Content Schemas:
- Diary: { "entries": [{ "date": "string", "text": "string" }] }
- Chapters: { "chapters": [{ "heading": "string", "body": "string" }] }
- Brainstorm: { "thesis": "string", "pros": ["string"], "cons": ["string"], "ideas": ["string"] }
`;

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
    if (parsed.action === 'propose') {
      const newProjectRef = await db.collection('projects').add({
        ...parsed.projectDetails,
        uid,
        status: 'draft',
        createdAt: FieldValue.serverTimestamp()
      });
      
      // Update all selected notes to belong to this project
      const batch = db.batch();
      for (const id of targetNoteIds) {
        batch.update(db.collection('notes').doc(id), { projectId: newProjectRef.id });
      }
      await batch.commit();
      
      return { status: 'proposed' };
    }
  } catch (e) {
    console.error("Failed to parse JSON", e);
  }
  return { status: 'ignored' };
});
