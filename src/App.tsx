import { useState, useRef, useEffect } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { db, app, auth, googleProvider } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, getDocs, updateDoc, deleteDoc } from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { getAI, getGenerativeModel } from 'firebase/ai';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(app);

const vertexAI = getAI(app);
const model = getGenerativeModel(vertexAI, { 
  model: 'gemini-3.5-flash'
});

const refiningProjects = new Set<string>();

const refineProjectMetaIfNeeded = async (p: any) => {
  if (!p.id || refiningProjects.has(p.id) || p.status === 'proposed') return;
  
  const noteCount = (p.sourceNoteIds && Array.isArray(p.sourceNoteIds)) ? p.sourceNoteIds.length : 0;
  const isSummaryBloated = !p.summary || p.summary.length > 120 || p.summary.split(' ').length > 18 || p.summary.includes(' – wie ') || p.summary.includes('Neben exklusiven');
  const isLatestGeneric = !p.latestChange || p.latestChange.length > 130 || 
    p.latestChange.startsWith('Synthesized') || 
    p.latestChange.startsWith('Updated') || 
    p.latestChange.startsWith('Proposed') || 
    p.latestChange.startsWith('Manually') ||
    p.latestChange.startsWith('Project initialized') ||
    p.latestChange.startsWith('AI detected') ||
    p.latestChange.startsWith('Die Notizen');
  const isTitleOutdated = (noteCount >= 5 && p.title && (p.title.includes(':') || p.title.includes('Panem') || p.title.includes('&') || p.title.length > 50));

  if (!isSummaryBloated && !isLatestGeneric && !isTitleOutdated) return;
  
  refiningProjects.add(p.id);
  try {
    let noteTexts: string[] = [];
    const currentUid = auth.currentUser?.uid || p.uid;
    const q = query(collection(db, 'notes'), where('uid', '==', currentUid), where('projectId', '==', p.id));
    const noteSnaps = await getDocs(q);
    noteTexts = noteSnaps.docs.map(d => d.data().text as string).filter(Boolean);
    
    if (noteTexts.length === 0 && p.sourceNoteIds && Array.isArray(p.sourceNoteIds)) {
      const snaps = await Promise.all(
        p.sourceNoteIds.slice(-6).map((id: string) => getDoc(doc(db, 'notes', id)).catch(() => null))
      );
      noteTexts = snaps.map(s => s?.data()?.text as string).filter(Boolean);
    }
    
    const contextText = noteTexts.slice(-8).join('\n- ');
    const prompt = `Analyze this user project titled "${p.title}" (Archetype: ${p.archetype || 'Project'}) and its associated note captures (${noteCount || noteTexts.length} total notes):
- ${contextText || p.summary || p.title}

The current project title, summary, or latest change bullet needs to be refined and evolved to accurately match all note captures combined.
Your task is to generate THREE EXTREMELY CRISP, RAZOR-SHARP STRINGS in the primary language of the notes (e.g. German if the notes are in German, English if English):

1. "title": An evolved, high-level project title. CRITICAL RULE: If the project started with a narrow title mentioning specific initial stations (e.g. "Städtetrip Stockholm: Panem & Junibacken") but now contains many notes covering a broader scope (e.g. holiday house, spa, general vacation), you MUST generalize and upgrade the title (e.g. "Stockholm Städtetrip & Familienurlaub")!
2. "summary": EXACTLY ONE short declarative sentence summarizing the overall project topic in MAXIMUM 10 TO 12 WORDS (e.g. "Familienurlaub in Stockholm mit Städtetrip und Ferienhaus am See."). STRICT RULE: Do NOT write compound sentences, clauses, or long explanations! Keep it ultra-brief and punchy!
3. "latestChange": EXACTLY ONE short sentence explaining what specific thought, place, or insight was MOST RECENTLY discussed or noted, so the user instantly remembers where they left off (e.g. "Zuletzt notiert: Empfehlung für Spa-Gelände und Tiergehege für Kinder erhalten."). STRICT RULE: Do NOT output vague statistics like "Synthesized from X notes" or "Updated project"! Must state specific topic details from the newest captures!

Return ONLY raw JSON:
{
  "title": "...",
  "summary": "...",
  "latestChange": "..."
}`;

    const res = await model.generateContent([prompt]);
    const text = res.response.text();
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || [null, text.replace(/```json\n?|\n?```/g, '').trim()];
    const parsed = JSON.parse(jsonMatch[1]!);
    
    const updateData: any = {};
    if (parsed.title) { updateData.title = parsed.title; p.title = parsed.title; }
    if (parsed.summary && parsed.summary.length <= 130) { updateData.summary = parsed.summary; p.summary = parsed.summary; }
    if (parsed.latestChange) { updateData.latestChange = parsed.latestChange; p.latestChange = parsed.latestChange; }

    if (Object.keys(updateData).length > 0) {
      await updateDoc(doc(db, 'projects', p.id), updateData);
    }
  } catch (e) {
    console.warn("Could not auto-refine project meta:", e);
  }
};

const getLocationString = async (): Promise<string | null> => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`);
          const data = await res.json();
          const city = data.address?.city || data.address?.town || data.address?.village || data.address?.suburb;
          const country = data.address?.country;
          if (city && country) resolve(`${city}, ${country}`);
          else if (city) resolve(city);
          else resolve(`${latitude.toFixed(2)}, ${longitude.toFixed(2)}`);
        } catch (e) {
          resolve(`${pos.coords.latitude.toFixed(2)}, ${pos.coords.longitude.toFixed(2)}`);
        }
      },
      () => resolve(null),
      { timeout: 5000 }
    );
  });
};




function InboxScreen({ user, onSelectProject, orchestratorState }: { user: User, onSelectProject: (p: any) => void, orchestratorState: string }) {
  const [projects, setProjects] = useState<any[]>([]);
  const [movingProposalId, setMovingProposalId] = useState<string | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'projects'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const loaded = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setProjects(loaded);
      loaded.forEach(p => refineProjectMetaIfNeeded(p));
    }, (error) => {
      console.error("Firestore error:", error);
      alert("Firestore error loading projects: " + error.message);
    });
    return () => unsubscribe();
  }, [user.uid]);

  const proposedProjects = projects.filter(p => p.status === 'proposed');
  const activeProjects = projects.filter(p => p.status !== 'proposed');

  const handleCreateProject = async (p: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await updateDoc(doc(db, 'projects', p.id), { 
        status: 'accepted', 
        latestChange: p.latestChange || p.reasoning || 'Project proposal accepted into active collection.',
        updatedAt: serverTimestamp() 
      });
      if (p.sourceNoteIds && Array.isArray(p.sourceNoteIds)) {
        await Promise.all(p.sourceNoteIds.map(async (nid: string) => {
          try {
            await updateDoc(doc(db, 'notes', nid), { projectId: p.id });
          } catch (noteErr) {
            console.warn(`Could not bind note ${nid} (possibly deleted or missing):`, noteErr);
          }
        }));
      }
    } catch (err: any) {
      alert("Error creating project: " + err.message);
    }
  };

  const handleDiscardProposal = async (p: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Discard this suggested project? Your voice notes will remain safely in Memory.")) return;
    try {
      await deleteDoc(doc(db, 'projects', p.id));
    } catch (err: any) {
      alert("Error discarding proposal: " + err.message);
    }
  };

  const handleMoveToExisting = async (proposal: any, targetProject: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (proposal.sourceNoteIds && Array.isArray(proposal.sourceNoteIds) && proposal.sourceNoteIds.length > 0) {
        const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
        await orchestrateNotesFn({ action: 'append_to_existing', targetProjectId: targetProject.id, noteIds: proposal.sourceNoteIds });
      }
      await deleteDoc(doc(db, 'projects', proposal.id));
      setMovingProposalId(null);
      alert(`Notes synthesized and integrated into "${targetProject.title}"!`);
    } catch (err: any) {
      alert("Error moving notes: " + err.message);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="display-2" style={{ fontWeight: "bold" }}>Projects</Text>
        <OrchestratorStatus state={orchestratorState} />
      </div>

      {proposedProjects.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Text type="label" color="primary" style={{ fontWeight: 'bold', fontSize: '0.85rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              PROPOSED PROJECTS AWAITING REVIEW ({proposedProjects.length})
            </Text>
          </div>
          {proposedProjects.map(p => (
            <Card 
              key={p.id} 
              style={{ 
                padding: '20px', 
                cursor: 'pointer', 
                backgroundColor: 'var(--color-bg-elevated)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: '12px'
              }} 
              onClick={() => onSelectProject(p)}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>
                      PROPOSAL • {p.archetype?.toUpperCase() || 'PROJECT'}
                    </span>
                    <Text type="body" style={{ fontWeight: 600, fontSize: '1.3rem', marginTop: '4px', display: 'block', color: 'var(--color-text-primary)' }}>{p.title}</Text>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                  <div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                      SUMMARY
                    </span>
                    <Text type="body" style={{ color: 'var(--color-text-primary)', fontSize: '0.95rem', lineHeight: 1.4, margin: 0 }}>
                      {p.summary || p.shortSummary || 'AI detected a unified theme across your captures.'}
                    </Text>
                  </div>
                  <div>
                    <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                      WHERE YOU LEFT OFF
                    </span>
                    <Text type="body" style={{ color: 'var(--color-text-primary)', fontSize: '0.95rem', lineHeight: 1.4, margin: 0 }}>
                      {p.latestChange || "Proposed new structure based on recent unassigned captures."}
                    </Text>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
                  <Button variant="primary" label="Create Project" onClick={(e: any) => handleCreateProject(p, e)} />
                  {activeProjects.length > 0 && (
                    <Button variant="secondary" label="Move to Existing..." onClick={() => setMovingProposalId(movingProposalId === p.id ? null : p.id)} />
                  )}
                  <Button variant="ghost" label="Discard" style={{ color: 'var(--color-text-secondary)', marginLeft: 'auto' }} onClick={(e: any) => handleDiscardProposal(p, e)} />
                </div>

                {movingProposalId === p.id && (
                  <div style={{ marginTop: '12px', padding: '12px', backgroundColor: 'var(--color-bg-base)', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }} onClick={e => e.stopPropagation()}>
                    <Text type="label" color="secondary" style={{ marginBottom: '8px', display: 'block' }}>Select destination project for these notes:</Text>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                      {activeProjects.map(ap => (
                        <div 
                          key={ap.id} 
                          style={{ padding: '8px 12px', borderRadius: '6px', backgroundColor: 'var(--color-bg-subtle)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                          onClick={(e) => handleMoveToExisting(p, ap, e)}
                        >
                          <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>{ap.title}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{ap.archetype || 'Project'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {proposedProjects.length > 0 && (
          <Text type="label" color="secondary" style={{ fontWeight: 'bold', fontSize: '0.9rem', letterSpacing: '0.5px', marginTop: '8px' }}>
            ACTIVE PROJECTS ({activeProjects.length})
          </Text>
        )}
        {activeProjects.length === 0 ? (
          <Center style={{ padding: '32px 0' }}>
            <Text type="supporting" color="secondary">
              No active projects yet. Speak thoughts from the home screen or go to the Capture tab to begin!
            </Text>
          </Center>
        ) : (
          activeProjects.map(p => {
            let dateStr = '';
            const timestamp = p.updatedAt || p.createdAt;
            if (timestamp?.toDate) {
              dateStr = timestamp.toDate().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
            } else if (timestamp && !isNaN(new Date(timestamp).getTime())) {
              dateStr = new Date(timestamp).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
            }
            const noteCount = p.sourceNoteIds?.length || 0;
            const countStr = noteCount === 1 ? '1 Note' : `${noteCount} Notes`;
            const metaStr = [countStr, dateStr].filter(Boolean).join(' · ');

            return (
              <Card 
                key={p.id} 
                style={{ 
                  padding: '22px', 
                  cursor: 'pointer', 
                  backgroundColor: 'var(--color-bg-elevated)', 
                  border: '1px solid var(--color-border-subtle)', 
                  borderRadius: '16px',
                  transition: 'transform 0.2s ease, box-shadow 0.2s ease' 
                }} 
                onClick={() => onSelectProject(p)}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    {p.archetype ? (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {p.archetype}
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Project
                      </span>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-secondary)', fontSize: '0.8rem', fontWeight: 500 }}>
                      <span>{metaStr}</span>
                      <span style={{ fontSize: '1rem', color: 'var(--color-text-primary)' }}>→</span>
                    </div>
                  </div>
                  <Text type="body" style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--color-text-primary)', lineHeight: 1.3, letterSpacing: '-0.01em' }}>
                    {p.title}
                  </Text>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '4px' }}>
                    <div>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                        SUMMARY
                      </span>
                      <Text type="body" style={{ fontSize: '0.95rem', color: 'var(--color-text-primary)', lineHeight: 1.4, margin: 0 }}>
                        {p.summary || p.shortSummary || p.draft || "Project active and accumulating insights."}
                      </Text>
                    </div>
                    <div>
                      <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '4px' }}>
                        WHERE YOU LEFT OFF
                      </span>
                      <Text type="body" style={{ fontSize: '0.95rem', color: 'var(--color-text-primary)', lineHeight: 1.4, margin: 0 }}>
                        {p.latestChange || (noteCount === 1 ? "Project initialized from 1 voice capture." : `Synthesized from ${noteCount} recorded captures.`)}
                      </Text>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Archetype UI Templates
// -----------------------------------------------------------------------------

function SummaryCard({ summary, nextSteps, metaAnalysis }: { summary?: string, nextSteps?: string[], metaAnalysis?: any, project?: any }) {
  const keyTakeaways = metaAnalysis?.keyTakeaways;
  const interestingOpportunities = metaAnalysis?.interestingOpportunities;
  const totalInsights = (keyTakeaways?.length || 0) + (interestingOpportunities?.length || 0) + (nextSteps?.length || 0);

  if (!summary && totalInsights === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', marginBottom: '12px' }}>
      {summary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '0.75rem', fontWeight: 700 }}>Executive Summary</Text>
          <Text type="body" style={{ fontSize: '1.12rem', lineHeight: 1.6, color: 'var(--color-text-primary)', display: 'block', fontWeight: 400 }}>{summary}</Text>
        </div>
      )}

      {totalInsights > 0 && (
        <details style={{ borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)', padding: '6px 0' }}>
          <summary style={{ padding: '12px 0', cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1rem', listStyle: 'none', outline: 'none', userSelect: 'none' }}>
            <span>Takeaways, Opportunities & Steps ({totalInsights})</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>▾</span>
          </summary>
          <div style={{ padding: '12px 0 16px 0', display: 'flex', flexDirection: 'column', gap: '24px', borderTop: '1px solid var(--color-border-subtle)', marginTop: '6px' }}>
            {keyTakeaways && keyTakeaways.length > 0 && (
              <div>
                <Text type="label" color="secondary" style={{ marginBottom: '10px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Key Takeaways So Far
                </Text>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '10px', color: 'var(--color-text-primary)' }}>
                  {keyTakeaways.map((takeaway: string, idx: number) => (
                    <li key={idx}><Text type="body" style={{ lineHeight: 1.55, display: 'block', fontSize: '0.98rem' }}>{takeaway}</Text></li>
                  ))}
                </ul>
              </div>
            )}
            {interestingOpportunities && interestingOpportunities.length > 0 && (
              <div style={{ borderTop: keyTakeaways?.length ? '1px solid var(--color-border-subtle)' : 'none', paddingTop: keyTakeaways?.length ? '20px' : 0 }}>
                <Text type="label" color="secondary" style={{ marginBottom: '10px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Interesting Opportunities & Suggestions
                </Text>
                <ul style={{ margin: 0, paddingLeft: '18px', display: 'flex', flexDirection: 'column', gap: '10px', color: 'var(--color-text-primary)' }}>
                  {interestingOpportunities.map((opp: string, idx: number) => (
                    <li key={idx}><Text type="body" style={{ lineHeight: 1.55, display: 'block', fontSize: '0.98rem' }}>{opp}</Text></li>
                  ))}
                </ul>
              </div>
            )}
            {nextSteps && nextSteps.length > 0 && (
              <div style={{ borderTop: (keyTakeaways?.length || interestingOpportunities?.length) ? '1px solid var(--color-border-subtle)' : 'none', paddingTop: (keyTakeaways?.length || interestingOpportunities?.length) ? '20px' : 0 }}>
                <Text type="label" color="secondary" style={{ marginBottom: '10px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Actionable Next Steps
                </Text>
                <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {nextSteps.map((step: string, i: number) => (
                    <li key={i}><Text type="body" style={{ lineHeight: 1.55, display: 'block', fontSize: '0.98rem' }}>{step}</Text></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function DiaryTemplate({ content, summary }: { content: any, summary?: string }) {
  if (!content) return null;
  // Dedupe: if Executive Summary is already displayed, avoid rendering duplicate narrative overview
  if (content.narrativeOverview && !summary) {
    return (
      <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '16px', border: '1px solid var(--color-border-subtle)' }}>
        <Text type="label" color="secondary" style={{ marginBottom: '10px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>Story & Narrative Overview</Text>
        <Text type="body" style={{ lineHeight: 1.6, fontSize: '1.05rem', whiteSpace: 'pre-wrap', display: 'block', color: 'var(--color-text-primary)' }}>{content.narrativeOverview}</Text>
      </Card>
    );
  }
  return null;
}


function ChaptersTemplate({ content }: { content: any }) {
  if (!content || !content.chapters) return <Text type="body" style={{ display: 'block' }}>Invalid Chapters Content</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {content.chapters.map((chapter: any, i: number) => (
        <Card key={i} style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <div style={{ marginBottom: '14px' }}>
            <Text type="label" color="secondary" style={{ display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '4px', fontWeight: 600 }}>
              Chapter {i + 1}
            </Text>
            <Text type="body" style={{ display: 'block', fontSize: '1.3rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.3 }}>
              {chapter.heading}
            </Text>
          </div>
          <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '16px' }}>
            <Text type="body" style={{ display: 'block', lineHeight: 1.6, color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap', fontSize: '1.02rem' }}>
              {chapter.body}
            </Text>
          </div>
        </Card>
      ))}
    </div>
  );
}


function BrainstormTemplate({ content }: { content: any }) {
  if (!content) return <Text type="body" style={{ display: 'block' }}>Invalid Brainstorm Content</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {content.thesis && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '6px', display: 'block', fontWeight: 600 }}>Thesis</Text>
          <Text type="body" style={{ display: 'block', fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{content.thesis}</Text>
        </Card>
      )}
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '12px', display: 'block', fontWeight: 600 }}>Pros</Text>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
            {content.pros?.map((pro: string, i: number) => <li key={i}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{pro}</Text></li>)}
          </ul>
        </Card>
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '12px', display: 'block', fontWeight: 600 }}>Cons</Text>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
            {content.cons?.map((con: string, i: number) => <li key={i}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{con}</Text></li>)}
          </ul>
        </Card>
      </div>

      {content.ideas && content.ideas.length > 0 && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', marginBottom: '12px', display: 'block', fontWeight: 600 }}>Generated Ideas</Text>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
            {content.ideas.map((idea: string, i: number) => <li key={i}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{idea}</Text></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}



function ProjectDetailScreen({ project, onBack, orchestratorState }: { project: any, onBack: () => void, orchestratorState: string }) {
  const [sourceNotes, setSourceNotes] = useState<any[]>([]);
  const [showMeeting, setShowMeeting] = useState(false);
  const [status, setStatus] = useState(project.status || 'accepted');
  const [isSourceExpanded, setIsSourceExpanded] = useState(false);
  const [showAllPlaces, setShowAllPlaces] = useState(false);
  
  // Place verification modal state
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [editedPlaceQuery, setEditedPlaceQuery] = useState<string>('');
  const [isSavingPlace, setIsSavingPlace] = useState(false);

  const acceptProject = async () => {
    try {
      await updateDoc(doc(db, 'projects', project.id), { 
        status: 'accepted',
        latestChange: project.latestChange || project.reasoning || 'Project proposal accepted into active collection.',
        updatedAt: serverTimestamp()
      });
      setStatus('accepted');
    } catch (e) {
      console.error(e);
    }
  };

  const discardProject = async () => {
    try {
      await deleteDoc(doc(db, 'projects', project.id));
      onBack();
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const currentUid = auth.currentUser?.uid || project.uid;
        const noteMap = new Map<string, any>();

        // 1. Fetch by explicit projectId query with mandatory uid filter
        if (currentUid) {
          const q = query(collection(db, 'notes'), where('uid', '==', currentUid), where('projectId', '==', project.id));
          const qSnaps = await getDocs(q).catch(() => null);
          if (qSnaps) {
            qSnaps.docs.forEach(d => noteMap.set(d.id, { id: d.id, ...d.data() }));
          }
        }

        // 2. Also fetch any bound sourceNoteIds not caught by query
        const sourceIds = project.sourceNoteIds || [];
        for (const id of sourceIds) {
          if (!noteMap.has(id)) {
            try {
              const docRef = doc(db, 'notes', id);
              const docSnap = await getDoc(docRef);
              if (docSnap.exists() && (!currentUid || docSnap.data()?.uid === currentUid)) {
                noteMap.set(id, { id: docSnap.id, ...docSnap.data() });
              }
            } catch (e) {}
          }
        }
        
        const notes = Array.from(noteMap.values());
        // Sort chronologically (oldest to newest for timeline/timespan accuracy)
        notes.sort((a, b) => {
          const tA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return tA - tB;
        });
        setSourceNotes(notes);
      } catch (err) {
        console.warn("Could not fetch notes:", err);
      }
    };
    fetchNotes();
  }, [project]);

  if (showMeeting) {
    return <MeetingScreen project={project} onBack={() => setShowMeeting(false)} />;
  }

  const metaAnalysis = project.metaAnalysis || project.content?.metaAnalysis;
  const placesVisited: string[] = metaAnalysis?.placesVisited || [];
  const displayPlaces = showAllPlaces ? placesVisited : placesVisited.slice(0, 3);
  
  // Smart Place Query Cleaner for Maps & Best-Guess verification
  const cleanPlaceForMaps = (rawPlace: string) => {
    let cleaned = rawPlace
      .replace(/\s*\([^)]*\)/g, ' ') // remove parentheses like (Supermarkt, Schweden) or (nahe Boo)
      .replace(/\b(nahe|bei|near|in der Nähe von|Schweden-Aufenthalt)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) cleaned = rawPlace.replace(/\s*\([^)]*\)/g, '').trim() || rawPlace;
    return cleaned;
  };

  const handleOpenPlaceVerification = (place: string) => {
    setSelectedPlace(place);
    setEditedPlaceQuery(cleanPlaceForMaps(place));
  };

  const handleSaveVerifiedPlace = async () => {
    if (!selectedPlace || !editedPlaceQuery.trim()) return;
    setIsSavingPlace(true);
    try {
      const updatedPlaces = placesVisited.map(p => p === selectedPlace ? editedPlaceQuery.trim() : p);
      const updatedMeta = { ...metaAnalysis, placesVisited: Array.from(new Set(updatedPlaces)) };
      await updateDoc(doc(db, 'projects', project.id), {
        metaAnalysis: updatedMeta,
        updatedAt: serverTimestamp()
      });
      project.metaAnalysis = updatedMeta; // update local ref
      setSelectedPlace(null);
    } catch (e: any) {
      alert("Could not update place name: " + e.message);
    } finally {
      setIsSavingPlace(false);
    }
  };
  
  // Dynamically calculate timespan from actual source note entries so additions immediately reflect
  let timespanStr = '';
  let topicSuffix = '';
  if (metaAnalysis?.timespan && metaAnalysis.timespan.includes('·')) {
    const parts = metaAnalysis.timespan.split('·');
    if (parts.length > 1) topicSuffix = ' · ' + parts.slice(1).join('·').trim();
  } else if (metaAnalysis?.timespan && !metaAnalysis.timespan.match(/^\d/)) {
    topicSuffix = ' · ' + metaAnalysis.timespan;
  }

  if (sourceNotes && sourceNotes.length > 0) {
    const dates = sourceNotes
      .map(n => n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt ? new Date(n.createdAt) : null))
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length === 1) {
      const d = dates[0];
      timespanStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (dates.length > 1) {
      const d1 = dates[0];
      const d2 = dates[dates.length - 1];
      const date1 = d1.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time1 = d1.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const date2 = d2.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const time2 = d2.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      if (date1 === date2) {
        timespanStr = `${date1} ${time1} – ${time2}`;
      } else {
        timespanStr = `${date1} ${time1} – ${date2} ${time2}`;
      }
    }
    if (timespanStr && topicSuffix) {
      timespanStr += topicSuffix;
    }
  }
  
  // Fallback to static metaAnalysis or creation date if no notes
  if (!timespanStr) {
    timespanStr = metaAnalysis?.timespan || '';
  }
  if (!timespanStr && project?.createdAt?.toDate) {
    const d = project.createdAt.toDate();
    timespanStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
      {/* Location Verification & Best-Guess Map Dialog */}
      {selectedPlace && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(3px)', padding: '20px' }}>
          <Card style={{ padding: '28px', width: '100%', maxWidth: '420px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', borderRadius: '24px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.3)', position: 'relative', zIndex: 10001 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <Text type="body" style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--color-text-primary)' }}>Explore Location</Text>
              <Button variant="ghost" label="✕" onClick={() => setSelectedPlace(null)} style={{ padding: '4px 10px', fontSize: '1.1rem', color: 'var(--color-text-secondary)' }} />
            </div>
            
            <Text type="supporting" style={{ fontSize: '0.92rem', lineHeight: 1.5, color: 'var(--color-text-secondary)', marginBottom: '20px', display: 'block' }}>
              We refined your voice note into an optimized Google Maps search. Adjust below if needed before opening:
            </Text>

            <div style={{ marginBottom: '24px' }}>
              <Text type="label" style={{ display: 'block', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-secondary)', marginBottom: '8px', fontWeight: 600 }}>Search Query</Text>
              <input
                type="text"
                value={editedPlaceQuery}
                onChange={e => setEditedPlaceQuery(e.target.value)}
                placeholder="Location name..."
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: '14px',
                  border: '1px solid var(--color-border-strong)',
                  backgroundColor: 'var(--color-bg-subtle)',
                  color: 'var(--color-text-primary)',
                  fontSize: '1rem',
                  outline: 'none',
                  fontWeight: 600,
                  boxSizing: 'border-box'
                }}
              />
              {selectedPlace !== editedPlaceQuery && (
                <div style={{ marginTop: '8px', fontSize: '0.82rem', color: 'var(--color-text-secondary)' }}>
                  Original note: <span style={{ fontStyle: 'italic' }}>"{selectedPlace}"</span>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(editedPlaceQuery || selectedPlace)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  if (editedPlaceQuery !== selectedPlace) {
                    handleSaveVerifiedPlace();
                  } else {
                    setSelectedPlace(null);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  width: '100%',
                  padding: '15px',
                  borderRadius: '14px',
                  backgroundColor: 'var(--color-text-primary)',
                  color: 'var(--color-bg-elevated)',
                  fontWeight: 600,
                  fontSize: '1rem',
                  textDecoration: 'none',
                  textAlign: 'center',
                  cursor: 'pointer',
                  boxSizing: 'border-box',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
                }}
              >
                <span>Open in Google Maps</span>
                <span style={{ fontSize: '0.85rem' }}>↗</span>
              </a>
              
              {editedPlaceQuery !== selectedPlace && (
                <Button
                  variant="ghost"
                  label={isSavingPlace ? "Saving..." : "Save Clean Name to Project"}
                  onClick={handleSaveVerifiedPlace}
                  style={{ width: '100%', padding: '12px', borderRadius: '12px', fontWeight: 600, fontSize: '0.9rem', color: 'var(--color-text-primary)', backgroundColor: 'var(--color-bg-subtle)' }}
                />
              )}
              
              <Button
                variant="ghost"
                label="Cancel"
                onClick={() => setSelectedPlace(null)}
                style={{ width: '100%', padding: '12px', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}
              />
            </div>
          </Card>
        </div>
      )}

      <div style={{ paddingBottom: '16px', borderBottom: '1px solid var(--color-border-subtle)', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="ghost" label="← Back to Inbox" onClick={onBack} size="sm" style={{ paddingLeft: 0, fontWeight: 600 }} />
        <OrchestratorStatus state={orchestratorState} />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '40px' }}>
      {status === 'proposed' && (
        <Card style={{ padding: '20px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', borderRadius: '14px' }}>
          <Text type="label" color="secondary" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', display: 'block', fontWeight: 600 }}>Project Proposal</Text>
          <Text type="body" style={{ marginBottom: '16px', lineHeight: 1.5, display: 'block' }}>
            The Orchestrator has proposed this project. You can accept it to keep it, discard it, or use the meeting below to adjust the scope first.
          </Text>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button variant="primary" label="Accept Project" onClick={acceptProject} />
            <Button variant="ghost" label="Discard Proposal" style={{ color: 'var(--color-text-secondary)' }} onClick={discardProject} />
          </div>
        </Card>
      )}

      <div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '20px' }}>
          <Text type="body" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2, display: 'block', letterSpacing: '-0.01em' }}>
            {project.title}
          </Text>

          {/* Compact Hero Meta-Row: Archetype & Dynamically Updated Timespan */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>
            {project.archetype && (
              <span style={{ fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-primary)' }}>
                {project.archetype}
              </span>
            )}
            {project.archetype && timespanStr && <span>•</span>}
            {timespanStr && (
              <span>{timespanStr}</span>
            )}
          </div>
          
          {/* Sleek Collapsible Places Bar (Solves Vertical Sprawl & Enables Interactive Verification) */}
          {placesVisited && placesVisited.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginTop: '6px', fontSize: '0.92rem', lineHeight: '1.6' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>Places:</span>
              {displayPlaces.map((place: string, idx: number) => (
                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <button
                    onClick={() => handleOpenPlaceVerification(place)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '3px',
                      padding: 0,
                      background: 'none',
                      border: 'none',
                      fontSize: '0.92rem',
                      color: 'var(--color-text-primary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textDecoration: 'underline',
                      textUnderlineOffset: '4px',
                      textDecorationColor: 'var(--color-border-strong)',
                      outline: 'none'
                    }}
                    title={`Verify & Explore "${place}"`}
                  >
                    <span>{place}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>↗</span>
                  </button>
                  {idx < displayPlaces.length - 1 && <span style={{ color: 'var(--color-text-secondary)', marginLeft: '12px' }}>•</span>}
                </span>
              ))}
              {placesVisited.length > 3 && (
                <button
                  onClick={() => setShowAllPlaces(!showAllPlaces)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 0,
                    background: 'none',
                    border: 'none',
                    fontSize: '0.85rem',
                    color: 'var(--color-text-secondary)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginLeft: '4px'
                  }}
                >
                  {showAllPlaces ? '(Show less ▴)' : `(+${placesVisited.length - 3} more ▾)`}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Promoted Primary Interaction: Consult Expert */}
        <div style={{ marginBottom: '24px' }}>
          <Button 
            variant="primary" 
            label="Consult Expert" 
            onClick={() => setShowMeeting(true)} 
            style={{ width: '100%', padding: '14px 20px', fontSize: '1.02rem', fontWeight: 600, borderRadius: '14px' }} 
          />
        </div>

        <SummaryCard 
          summary={project.summary} 
          nextSteps={project.nextSteps} 
          metaAnalysis={metaAnalysis} 
          project={project} 
        />

        {/* Dynamic content rendering based on archetype or legacy draft */}
        <div style={{ marginTop: '20px' }}>
          {project.archetype === 'Diary' && project.content ? <DiaryTemplate content={project.content} summary={project.summary} /> :
           project.archetype === 'Chapters' && project.content ? <ChaptersTemplate content={project.content} /> :
           project.archetype === 'Brainstorm' && project.content ? <BrainstormTemplate content={project.content} /> :
           <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '16px', border: '1px solid var(--color-border-subtle)' }}>
             <Text type="body" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '1.05rem' }}>{project.draft || JSON.stringify(project.content, null, 2)}</Text>
           </Card>
          }
        </div>
      </div>

      {/* Source Material Inspector */}
      {sourceNotes.length > 0 && (
        <div id="rag-audit-trail" style={{ marginTop: '24px', borderTop: '1px solid var(--color-border-subtle)', borderBottom: '1px solid var(--color-border-subtle)', padding: '6px 0' }}>
          <div 
            onClick={() => setIsSourceExpanded(!isSourceExpanded)}
            style={{ padding: '12px 0', cursor: 'pointer', fontWeight: 600, color: 'var(--color-text-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '1rem', userSelect: 'none', transition: 'all 0.2s ease' }}
          >
            <span>Inspect Trail ({sourceNotes.length})</span>
            <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>{isSourceExpanded ? '▴' : '▾'}</span>
          </div>
          
          {isSourceExpanded && (
            <div style={{ padding: '16px 0 20px 0', display: 'flex', flexDirection: 'column', gap: '20px', borderTop: '1px solid var(--color-border-subtle)', marginTop: '6px' }}>
              <Text type="supporting" color="secondary" style={{ fontSize: '0.9rem', lineHeight: 1.5, display: 'block', marginBottom: '4px' }}>
                Original voice recordings and notes used to generate this project's summary and action items:
              </Text>
              {sourceNotes.map((note, index) => (
                <div key={note.id || index} style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: index < sourceNotes.length - 1 ? '20px' : '4px', borderBottom: index < sourceNotes.length - 1 ? '1px dashed var(--color-border-subtle)' : 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                      <span style={{ fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--color-text-primary)' }}>
                        {note.category || 'NOTE'}
                      </span>
                      <span>•</span>
                      <span style={{ color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                        {note.createdAt?.toDate ? note.createdAt.toDate().toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </span>
                    </div>
                    {note.locationString && (
                      <span style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>
                        {note.locationString}
                      </span>
                    )}
                  </div>
                  <Text type="body" style={{ lineHeight: 1.6, fontSize: '0.98rem', color: 'var(--color-text-primary)', display: 'block', whiteSpace: 'pre-wrap', margin: 0 }}>{note.text}</Text>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'center' }}>
        <Button 
          variant="ghost" 
          label="Delete Project" 
          onClick={async () => {
            if (!confirm('Are you sure you want to delete this project? Your original voice recordings will remain safely stored in Memory.')) return;
            try {
              if (project.sourceNoteIds && Array.isArray(project.sourceNoteIds)) {
                await Promise.all(project.sourceNoteIds.map(async (id: string) => {
                  try {
                    await updateDoc(doc(db, 'notes', id), { projectId: null });
                  } catch (noteErr) {
                    console.warn(`Could not unbind note ${id} during project deletion:`, noteErr);
                  }
                }));
              }
              await deleteDoc(doc(db, 'projects', project.id));
              onBack();
            } catch (err: any) {
              alert("Error deleting project: " + err.message);
            }
          }} 
          style={{ color: 'var(--color-text-secondary)', fontWeight: 500, fontSize: '0.85rem' }} 
        />
      </div>

      </div>
    </div>
  );
}

function MeetingScreen({ project, onBack }: { project: any, onBack: () => void }) {
  const [chatLog, setChatLog] = useState<{role: string, text: string, quickActions?: string[]}[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [proposedChanges, setProposedChanges] = useState<any>(null);
  
  const chatSession = useRef<any>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  useEffect(() => {
    chatSession.current = model.startChat({
      history: [
        { role: 'user', parts: [{ text: `We are having a voice-and-text consultation about my project titled "${project.title}". Archetype: ${project.archetype || 'Project'}. Current content: ${JSON.stringify(project.content || project.draft || project.summary)}

You are an expert project consultant and brainstorming partner.
CRITICAL COMMUNICATION AND FORMATTING RULES:
1. EXTREMELY BRIEF & TO THE POINT: Keep all responses concise, direct, and crisp (typically 1 to 3 short sentences). Never generate verbose lectures or unrequested lengthy lists unless the user explicitly asks for a long or detailed explanation.
2. STRICT PLAIN TEXT ONLY (ABSOLUTELY NO MARKDOWN): You MUST format your replies purely in plain text. Do NOT use markdown syntax under any circumstances! Never use asterisks for bolding (**bold** or *italics*), do NOT use bullet symbols or markdown headers (# or *). Rely purely on natural conversational phrasing and simple punctuation.
3. NATURAL SPEAKING TONE: Because answers may be read aloud via TTS speech, sound natural, conversational, and directly helpful without formatting artifacts.` }] },
        { role: 'model', parts: [{ text: 'Hello! I am ready to discuss your project. What would you like to focus on today?' }] }
      ]
    });
    setChatLog([{ role: 'model', text: 'Hello! I am ready to discuss your project. What would you like to focus on today?' }]);
  }, [project]);

  const sendTextMessage = async (msgText: string) => {
    if (!msgText.trim() || isSending) return;
    setMessage('');
    setChatLog(prev => [...prev, { role: 'user', text: msgText }]);
    setIsSending(true);

    try {
      const result = await chatSession.current.sendMessage(msgText);
      const rawText = result.response.text();
      const replyText = rawText
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_{1,2}([^_]+)_{1,2}/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .trim();
      setChatLog(prev => [...prev, { role: 'model', text: replyText }]);
    } catch (e) {
      console.error(e);
      setChatLog(prev => [...prev, { role: 'model', text: 'Error processing response.' }]);
    }
    setIsSending(false);
  };

  const playAudio = async (text: string) => {
    try {
      const synthesizeSpeech = httpsCallable(functions, 'synthesizeSpeech');
      const response = await synthesizeSpeech({ text });
      const audioContent = (response.data as any).audioContent;
      if (audioContent) {
        const audio = new Audio("data:audio/mp3;base64," + audioContent);
        audio.play();
      }
    } catch (e) {
      console.error("TTS error", e);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mediaRecorder.current.onstop = async () => {
        const mimeType = mediaRecorder.current?.mimeType || 'audio/webm';
        const cleanMimeType = mimeType.split(';')[0];
        const audioBlob = new Blob(audioChunks.current, { type: cleanMimeType });
        mediaRecorder.current?.stream.getTracks().forEach(track => track.stop());
        if (audioBlob.size > 0) {
          await processAudio(audioBlob);
        }
      };
      mediaRecorder.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing microphone:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (blob: Blob) => {
    setIsSending(true);
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const inlineData = {
        inlineData: { data: base64Data, mimeType: blob.type || 'audio/webm' }
      };
      const transcriptionPrompt = `Transcribe the following audio exactly. Output only the transcription, nothing else.`;
      const transcriptionResult = await model.generateContent([transcriptionPrompt, inlineData]);
      const transcribedText = transcriptionResult.response.text().trim();
      
      if (transcribedText) {
        await sendTextMessage(transcribedText);
      }
    } catch (e) {
      console.error("Transcription error: ", e);
    }
    setIsSending(false);
  };

  const endMeeting = async () => {
    setIsSending(true);
    try {
      const transcriptText = chatLog.map(c => `${c.role === 'user' ? 'User' : 'Expert'}: ${c.text}`).join('\n');
      const prompt = `Based on the following meeting transcript, propose an updated project title (if relevant), updated content, an executive summary (EXACTLY 1 short, crisp sentence in MAXIMUM 10 to 12 words), and a description of what just changed (EXACTLY 1 short, crisp sentence specifying concrete topic details) for the project titled "${project.title}" (Archetype: ${project.archetype}). Current content: ${JSON.stringify(project.content || project.draft)}. Current summary: "${project.summary || ''}".
      
      Return ONLY a JSON object with this exact structure:
      {
        "title": "An updated, concise title reflecting the current project scope (update whenever relevant based on the meeting).",
        "content": { ...archetype content schema matching ${project.archetype}... },
        "summary": "EXACTLY ONE short declarative sentence summarizing the overall project essence in MAXIMUM 10 TO 12 WORDS. Do NOT write bloated compound sentences!",
        "latestChange": "EXACTLY ONE short sentence explicitly stating what specific concrete topic, decision, or insight was MOST RECENTLY discussed in this meeting so the user instantly remembers where they left off. Do NOT output vague administrative statistics!"
      }
      
      Transcript:
      ${transcriptText}`;
      
      const result = await model.generateContent([prompt]);
      const jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      const parsedResult = JSON.parse(jsonStr);
      setProposedChanges(parsedResult);
    } catch(e) {
      console.error(e);
      alert("Failed to process meeting. See console.");
    }
    setIsSending(false);
  };

  const saveTranscriptAsNote = async () => {
    if (chatLog.length <= 1) return;
    try {
      const transcriptText = chatLog.map(c => `${c.role === 'user' ? 'User' : 'Expert'}: ${c.text}`).join('\n\n');
      const locationString = await getLocationString();
      const noteRef = await addDoc(collection(db, 'notes'), {
        text: `Meeting Transcript:\n${transcriptText}`,
        category: 'Meeting',
        createdAt: serverTimestamp(),
        uid: auth.currentUser?.uid,
        projectId: project.id,
        locationString: locationString || null
      });
      const newSourceNoteIds = [...(project.sourceNoteIds || []), noteRef.id];
      await updateDoc(doc(db, 'projects', project.id), { sourceNoteIds: newSourceNoteIds });
    } catch (e) {
      console.error("Error saving transcript", e);
    }
  };

  const applyChanges = async () => {
    if (!proposedChanges) return;
    try {
      const newTitle = proposedChanges.title || project.title;
      const newContent = proposedChanges.content || proposedChanges;
      const newSummary = proposedChanges.summary || project.summary;
      const newLatestChange = proposedChanges.latestChange || "Refined project details through Project Expert consultation.";

      await updateDoc(doc(db, 'projects', project.id), { 
        title: newTitle,
        content: newContent,
        summary: newSummary,
        latestChange: newLatestChange,
        updatedAt: serverTimestamp()
      });
      project.title = newTitle;
      project.content = newContent; 
      project.summary = newSummary;
      project.latestChange = newLatestChange;
      await saveTranscriptAsNote();
      onBack(); // Return to project detail
    } catch (e) {
      console.error(e);
      alert("Error applying changes.");
    }
  };

  const discardChanges = async () => {
    await saveTranscriptAsNote();
    onBack(); // Return to project detail
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: 'var(--color-bg-base)' }}>
      {proposedChanges ? (
        <div style={{ padding: '28px 24px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '28px', maxWidth: '680px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Text type="display-3" style={{ color: 'var(--color-text-primary)', display: 'block', margin: 0 }}>Meeting Insights & Updates</Text>
            <Text type="body" color="secondary" style={{ fontSize: '1rem', lineHeight: 1.5, display: 'block', margin: 0 }}>
              The consultant has synthesized your discussion and proposed the following structure for your project.
            </Text>
          </div>

          {proposedChanges.title && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
                Proposed Project Title
              </span>
              <Text type="body" style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.3, display: 'block', margin: 0 }}>
                {proposedChanges.title}
              </Text>
            </div>
          )}

          {proposedChanges.summary && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '20px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
                Updated Executive Summary
              </span>
              <Text type="body" style={{ fontSize: '1.1rem', color: 'var(--color-text-primary)', lineHeight: 1.5, display: 'block', margin: 0 }}>
                {proposedChanges.summary}
              </Text>
            </div>
          )}

          {proposedChanges.latestChange && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '20px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
                Where You Left Off
              </span>
              <Text type="body" style={{ fontSize: '1rem', color: 'var(--color-text-primary)', lineHeight: 1.5, display: 'block', margin: 0 }}>
                {proposedChanges.latestChange}
              </Text>
            </div>
          )}

          {proposedChanges.content && (proposedChanges.content.narrativeOverview || proposedChanges.content.thesis || typeof proposedChanges.content === 'string') && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '20px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
                Refreshed Content Preview
              </span>
              <Text type="body" style={{ fontSize: '1rem', color: 'var(--color-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap', display: 'block', margin: 0 }}>
                {typeof proposedChanges.content === 'string' 
                  ? proposedChanges.content 
                  : (proposedChanges.content.narrativeOverview || proposedChanges.content.thesis || '')}
              </Text>
            </div>
          )}

          {proposedChanges.content && Array.isArray(proposedChanges.content.keyTakeaways) && proposedChanges.content.keyTakeaways.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '20px' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-secondary)' }}>
                Key Takeaways
              </span>
              <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
                {proposedChanges.content.keyTakeaways.map((t: any, i: number) => (
                  <li key={i} style={{ fontSize: '0.98rem', lineHeight: 1.5 }}>{typeof t === 'string' ? t : t.point || JSON.stringify(t)}</li>
                ))}
              </ul>
            </div>
          )}

          <div style={{ display: 'flex', gap: '14px', marginTop: '12px', paddingTop: '24px', borderTop: '1px solid var(--color-border-subtle)' }}>
            <Button variant="primary" label="Update Project" onClick={applyChanges} />
            <Button variant="ghost" label="Discard Proposals" onClick={discardChanges} style={{ color: 'var(--color-text-secondary)' }} />
          </div>
        </div>
      ) : (
        <>
          <div style={{ padding: '16px', borderBottom: '1px solid var(--color-border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button variant="ghost" label="Cancel Meeting" onClick={onBack} size="sm" />
            <Button variant="primary" label="End Meeting" onClick={endMeeting} size="sm" isDisabled={isSending} />
          </div>
          
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px', paddingBottom: '24px' }}>
            {chatLog.map((c, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: c.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
                <Text type="label" color="secondary" style={{ marginBottom: '4px' }}>
                  {c.role === 'user' ? 'You' : 'Project Expert'}
                </Text>
                <div style={{ 
                  padding: '14px 18px', 
                  backgroundColor: c.role === 'user' ? 'var(--color-bg-user-bubble, #262626)' : 'var(--color-bg-elevated, #ffffff)', 
                  borderRadius: '16px',
                  border: c.role === 'user' ? '1px solid rgba(128,128,128,0.2)' : '1px solid var(--color-border-subtle)',
                  maxWidth: '85%',
                  boxShadow: '0 2px 6px rgba(0, 0, 0, 0.05)'
                }}>
                  <Text type="body" style={{ color: c.role === 'user' ? 'var(--color-text-user-bubble, #ffffff)' : 'inherit', margin: 0, fontSize: '0.98rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.text}</Text>
                </div>
                {c.role === 'model' && (
                  <Button variant="ghost" label="Play Audio" size="sm" onClick={() => playAudio(c.text)} style={{ marginTop: '4px' }} />
                )}
              </div>
            ))}
          </div>

          <div style={{ 
            paddingTop: '16px', 
            borderTop: '1px solid var(--color-border-subtle)', 
            padding: '16px',
            backgroundColor: 'var(--color-bg)'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
              <Button 
                variant={isRecording ? 'destructive' : 'primary'} 
                size="lg"
                label={isRecording ? 'Tap to Stop' : isSending ? 'Thinking...' : 'Tap to Record Message'}
                onClick={() => isRecording ? stopRecording() : startRecording()}
                isDisabled={isSending && !isRecording}
                style={{ width: '100%', maxWidth: '300px', height: '64px', borderRadius: '32px', fontSize: '1.2rem' }}
                className={isSending && !isRecording ? 'processing-pulse' : ''}
              />
              <Text type="supporting" color="secondary">or</Text>
              <div style={{ display: 'flex', gap: '8px', width: '100%' }}>
                <input 
                  type="text" 
                  value={message} 
                  onChange={e => setMessage(e.target.value)} 
                  onKeyDown={e => e.key === 'Enter' && sendTextMessage(message)}
                  placeholder="Type a message..."
                  style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border-subtle)', background: 'var(--color-bg-subtle)', color: 'var(--color-text-primary)' }}
                />
                <Button variant="secondary" label={isSending ? "..." : "Send"} onClick={() => sendTextMessage(message)} isDisabled={isSending} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function useOrchestrator(user: any) {
  const [orchestratorState, setOrchestratorState] = useState('idle');
  const timerRef = useRef<any>(null);

  const handleNoteAdded = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    
    setOrchestratorState('waiting'); // immediately show waiting/gathering status
    
    timerRef.current = setTimeout(() => {
      runOrchestrator();
    }, 15000);
  };

  const runOrchestrator = async () => {
    if (!user) return;
    setOrchestratorState('processing');
    try {
      const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
      const response = await orchestrateNotesFn({ action: 'auto' });
      
      const result = response.data as any;
      if (result && result.status === 'proposed') {
        setOrchestratorState('completed');
        setTimeout(() => setOrchestratorState('idle'), 5000);
      } else {
        setOrchestratorState('idle');
      }
    } catch (e) {
      console.error("Orchestrator error", e);
      setOrchestratorState('idle');
    }
  };

  return { orchestratorState, setOrchestratorState, handleNoteAdded };
}

function OrchestratorStatus({ state }: { state: string }) {
  let text = 'AI is ready';
  let color = 'var(--color-text-secondary, #6b7280)';
  let dotClass = 'status-dot status-dot-idle';
  
  switch (state) {
    case 'analyzing':
      text = 'AI transcribing note...';
      color = '#3b82f6';
      dotClass = 'status-dot status-dot-analyzing';
      break;
    case 'waiting':
      text = 'AI gathering thoughts...';
      color = '#eab308';
      dotClass = 'status-dot status-dot-waiting';
      break;
    case 'processing':
      text = 'AI is thinking...';
      color = '#f59e0b';
      dotClass = 'status-dot status-dot-processing';
      break;
    case 'completed':
      text = 'New project proposed!';
      color = '#22c55e';
      dotClass = 'status-dot status-dot-completed';
      break;
    case 'idle':
    default:
      text = 'AI is ready';
      color = 'var(--color-text-secondary, #6b7280)';
      dotClass = 'status-dot status-dot-idle';
      break;
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '13px', color, fontWeight: 600, padding: '5px 12px', borderRadius: '18px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', transition: 'all 0.3s ease' }}>
      <div className={dotClass} />
      <span>{text}</span>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('capture');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);

  const { orchestratorState, setOrchestratorState, handleNoteAdded } = useOrchestrator(user);
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return <Center style={{ height: '100vh' }}><Text type="supporting">Loading...</Text></Center>;
  }

  if (!user) {
    return (
      <Center style={{ height: '100vh', flexDirection: 'column', gap: '24px' }}>
        <Text type="display-1" as="h1">Listner</Text>
        <Text type="body" color="secondary">Secure your thoughts.</Text>
        <Button 
          variant="primary" 
          size="lg" 
          label="Sign In with Google" 
          onClick={() => signInWithPopup(auth, googleProvider)} 
        />
      </Center>
    );
  }
  
  return (
    <div style={{ padding: '16px', maxWidth: '600px', margin: '0 auto', height: '100vh', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="display-1" as="h1">Listner</Text>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="secondary" size="sm" label="Feedback" onClick={() => window.open('https://docs.google.com/forms/d/e/1FAIpQLScV1WxsQ6FsdMC_JKmiB7xgjLK15FU-KrI3WS_W-yQTDTbUPQ/viewform?usp=publish-editor', '_blank')} />
          <Button variant="secondary" size="sm" label="Sign Out" onClick={() => signOut(auth)} />
        </div>
      </div>
      
      <SegmentedControl value={view} onChange={setView} label="View mode" layout="fill">
        <SegmentedControlItem value="capture" label="Capture" />
        <SegmentedControlItem value="projects" label="Projects" />
      </SegmentedControl>

      {view === 'capture' && user && <CaptureScreen user={user} onNoteAdded={handleNoteAdded} orchestratorState={orchestratorState} setOrchestratorState={setOrchestratorState} />}
      {view === 'projects' && user && !selectedProject && <InboxScreen user={user} onSelectProject={setSelectedProject} orchestratorState={orchestratorState} />}
      {view === 'projects' && user && selectedProject && <ProjectDetailScreen project={selectedProject} onBack={() => setSelectedProject(null)} orchestratorState={orchestratorState} />}
    </div>
  );
}

function CaptureScreen({ user, onNoteAdded, orchestratorState, setOrchestratorState }: { user: User, onNoteAdded: () => void, orchestratorState: string, setOrchestratorState: (s: string) => void }) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [status, setStatus] = useState('Tap to record your thought');
  const [showMemory, setShowMemory] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];

      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      mediaRecorder.current.onstop = async () => {
        const mimeType = mediaRecorder.current?.mimeType || 'audio/webm';
        const cleanMimeType = mimeType.split(';')[0];
        const audioBlob = new Blob(audioChunks.current, { type: cleanMimeType });
        
        mediaRecorder.current?.stream.getTracks().forEach(track => track.stop());

        if (audioBlob.size === 0) {
          setStatus('Error: Audio recording was empty. Please try holding the button longer.');
          return;
        }

        setStatus('Processing...');
        setIsProcessing(true);
        setOrchestratorState('analyzing');
        try {
          await processAudio(audioBlob);
        } catch {
          setOrchestratorState('idle');
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.current.start();
      setIsRecording(true);
      setStatus('Recording...');
    } catch (err) {
      console.error('Error accessing microphone:', err);
      setStatus('Error: Microphone access denied');
    }
  };

  const stopRecording = () => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  };

  const processAudio = async (blob: Blob) => {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const inlineData = {
        inlineData: {
          data: base64Data,
          mimeType: blob.type || 'audio/webm',
        }
      };

      const prompt = `You are the Listner AI, an active listener. 
First, output exactly one short, conversational sentence acknowledging what the user said (e.g. "Got it, saving your idea about the museum.").
Then, on a new line, provide a JSON object exactly like this:
\`\`\`json
{
  "text": "The full transcription...",
  "category": "A 1-2 word category like Work, Personal, Idea, Task, etc."
}
\`\`\`
`;

      const result = await model.generateContentStream([prompt, inlineData]);
      
      let fullText = '';
      for await (const chunk of result.stream) {
        fullText += chunk.text();
        const conversationalPart = fullText.split('```')[0].trim();
        if (conversationalPart) {
          setStatus(conversationalPart);
        }
      }

      // Clean up markdown formatting if the model wraps the JSON
      const jsonMatch = fullText.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonString = jsonMatch ? jsonMatch[1].trim() : fullText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(jsonString);

      const locationString = await getLocationString();

      await addDoc(collection(db, 'notes'), {
        text: parsed.text,
        category: parsed.category,
        createdAt: serverTimestamp(),
        uid: user.uid,
        projectId: null,
        locationString: locationString
      });
      onNoteAdded();
      setStatus('Saved successfully');
      setTimeout(() => setStatus('Tap to record your thought'), 3000);
    } catch (e) {
      console.error("Error processing audio: ", e);
      setStatus('Error processing audio.');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <Text type="display-2" style={{ fontWeight: "bold" }}>Capture</Text>
        <OrchestratorStatus state={orchestratorState} />
      </div>
      <Center style={{ flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center' }}>
          <Button 
            variant={isRecording ? 'destructive' : 'primary'} 
            size="lg"
            label={isRecording ? 'Tap to Stop' : isProcessing ? 'Processing...' : 'Tap to Record'}
            onClick={() => isRecording ? stopRecording() : startRecording()}
            style={{ width: '200px', height: '200px', borderRadius: '50%', fontSize: '1.5rem' }}
            className={isProcessing ? 'processing-pulse' : ''}
          />
          <Text type="body" color="secondary">{status}</Text>
          <Button 
            variant="ghost" 
            size="sm"
            label={showMemory ? 'Hide Recent Captures' : 'View Recent Captures'}
            onClick={() => setShowMemory(!showMemory)}
            style={{ marginTop: '24px' }}
          />
          
          {showMemory && (
            <div style={{ width: '100%', maxWidth: '600px', marginTop: '24px', borderTop: '1px solid var(--color-border-subtle)', paddingTop: '24px' }}>
              <MemoryScreen user={user} setOrchestratorState={setOrchestratorState} />
            </div>
          )}
        </div>
      </Center>
    </div>
  );
}

function MemoryScreen({ user, setOrchestratorState }: { user: User, setOrchestratorState: (s: string) => void }) {
  const [notes, setNotes] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeProjects, setActiveProjects] = useState<any[]>([]);
  const [showProjectSelector, setShowProjectSelector] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'notes'), where('uid', '==', user.uid), where('projectId', '==', null));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newNotes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      newNotes.sort((a: any, b: any) => {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        return timeB - timeA;
      });
      setNotes(newNotes);
    });
    return () => unsubscribe();
  }, [user.uid]);

  useEffect(() => {
    const qProjects = query(collection(db, 'projects'), where('uid', '==', user.uid));
    const unsubscribeProjects = onSnapshot(qProjects, (snapshot) => {
      const projs = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as any))
        .filter(p => p.status !== 'proposed');
      setActiveProjects(projs);
    });
    return () => unsubscribeProjects();
  }, [user.uid]);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleDelete = async (id: string) => {
    await deleteDoc(doc(db, 'notes', id));
  };

  const handleStartProject = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    setOrchestratorState('processing');
    try {
      const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
      await orchestrateNotesFn({ action: 'manual', noteIds: Array.from(selectedIds) });
      setSelectedIds(new Set());
      setOrchestratorState('completed');
      setTimeout(() => setOrchestratorState('idle'), 5000);
      alert('Project proposal created successfully!');
    } catch (e) {
      console.error(e);
      setOrchestratorState('idle');
      alert('Error creating project proposal');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToExisting = async (targetProject: any) => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    setOrchestratorState('processing');
    try {
      const idsArray = Array.from(selectedIds);
      const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
      await orchestrateNotesFn({ action: 'append_to_existing', targetProjectId: targetProject.id, noteIds: idsArray });
      setSelectedIds(new Set());
      setShowProjectSelector(false);
      setOrchestratorState('completed');
      setTimeout(() => setOrchestratorState('idle'), 5000);
      alert(`Notes synthesized and added to project "${targetProject.title}"!`);
    } catch (err: any) {
      console.error(err);
      setOrchestratorState('idle');
      alert('Error adding notes to project: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <Text type="display-3" as="h3">Unassigned Notes</Text>
      </div>
      
      {notes.length === 0 ? (
        <Center style={{ flex: 1, padding: '40px 0', flexDirection: 'column', gap: '8px' }}>
          <Text type="body" color="secondary">Your inbox is empty.</Text>
        </Center>
      ) : (
        notes.map(note => (
          <Card 
            key={note.id} 
            style={{ 
              padding: '16px', 
              cursor: 'pointer', 
              border: selectedIds.has(note.id) ? '2px solid var(--color-primary)' : undefined 
            }}
            onClick={() => toggleSelect(note.id)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                <Text type="label" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{note.category}</span>
                  <span style={{ fontSize: '0.85em', color: 'var(--color-text-secondary)', fontWeight: 'normal' }}>
                    {note.createdAt?.toDate ? note.createdAt.toDate().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    {note.locationString ? ` • ${note.locationString}` : ''}
                  </span>
                </Text>
                <Text type="body">{note.text}</Text>
              </div>
              <Button variant="secondary" onClick={(e: any) => { e.stopPropagation(); handleDelete(note.id); }} label="Delete" />
            </div>
          </Card>
        ))
      )}
      
      {selectedIds.size > 0 && (
        <div style={{ position: 'sticky', bottom: 16, background: 'var(--color-bg-subtle)', padding: '16px', borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '1px solid var(--color-border-subtle)' }}>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={handleStartProject} isDisabled={isProcessing} label={isProcessing ? 'Processing...' : 'Start New Proposal'} />
            {activeProjects.length > 0 && (
              <Button variant="secondary" isDisabled={isProcessing} onClick={() => setShowProjectSelector(!showProjectSelector)} label={showProjectSelector ? "Cancel" : "Add to Existing..."} />
            )}
          </div>
          
          {showProjectSelector && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingTop: '8px', borderTop: '1px solid var(--color-border-subtle)' }}>
              <Text type="label" color="secondary" style={{ marginBottom: '4px' }}>Select destination project:</Text>
              {activeProjects.map(ap => (
                <div 
                  key={ap.id} 
                  style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid var(--color-border-subtle)' }}
                  onClick={() => !isProcessing && handleAddToExisting(ap)}
                >
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-primary)' }}>{ap.title}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{ap.archetype || 'Project'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
