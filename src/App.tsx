import { useState, useRef, useEffect } from 'react';
import { Text } from '@astryxdesign/core/Text';
import { Card } from '@astryxdesign/core/Card';
import { Button } from '@astryxdesign/core/Button';
import { Center } from '@astryxdesign/core/Center';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { db, app, auth, googleProvider } from './firebase';
import { collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, where, doc, getDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { getAI, getGenerativeModel } from 'firebase/ai';
import { getFunctions, httpsCallable } from 'firebase/functions';

const functions = getFunctions(app);

const vertexAI = getAI(app);
const model = getGenerativeModel(vertexAI, { 
  model: 'gemini-3.5-flash'
});

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
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
      await updateDoc(doc(db, 'projects', p.id), { status: 'accepted', updatedAt: serverTimestamp() });
      if (p.sourceNoteIds && Array.isArray(p.sourceNoteIds)) {
        await Promise.all(p.sourceNoteIds.map((nid: string) => updateDoc(doc(db, 'notes', nid), { projectId: p.id })));
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

  const handleDeleteActiveProject = async (p: any, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${p.title}"? Your original voice recordings will remain safely stored in Memory.`)) return;
    try {
      if (p.sourceNoteIds && Array.isArray(p.sourceNoteIds)) {
        await Promise.all(p.sourceNoteIds.map((id: string) => updateDoc(doc(db, 'notes', id), { projectId: null })));
      }
      await deleteDoc(doc(db, 'projects', p.id));
    } catch (err: any) {
      alert("Error deleting project: " + err.message);
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
                    <span style={{ fontSize: '11px', fontWeight: 'bold', letterSpacing: '0.05em', padding: '4px 10px', borderRadius: '14px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)', marginBottom: '8px', display: 'inline-block' }}>
                      PROPOSAL • {p.archetype?.toUpperCase() || 'PROJECT'}
                    </span>
                    <Text type="body" style={{ fontWeight: 600, fontSize: '1.3rem', marginTop: '4px', display: 'block', color: 'var(--color-text-primary)' }}>{p.title}</Text>
                  </div>
                </div>

                {p.reasoning && (
                  <div style={{ padding: '12px 16px', backgroundColor: 'var(--color-bg-subtle)', borderRadius: '8px', border: '1px solid var(--color-border-subtle)' }}>
                    <Text type="supporting" style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem', fontStyle: 'italic', display: 'block' }}>
                      "{p.reasoning}"
                    </Text>
                  </div>
                )}

                <Text type="body" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.summary || p.shortSummary || p.draft || 'No summary available.'}
                </Text>

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
          activeProjects.map(p => (
            <Card key={p.id} style={{ padding: '16px', cursor: 'pointer', borderLeft: '4px solid var(--color-primary)' }} onClick={() => onSelectProject(p)}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text type="label" color="secondary" style={{ textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em' }}>Active Project</Text>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    label="Delete" 
                    onClick={(e: any) => { e.stopPropagation(); handleDeleteActiveProject(p, e); }} 
                    style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', padding: '4px 8px', height: 'auto' }}
                  />
                </div>
                <Text type="body" style={{ fontWeight: 'bold', fontSize: '1.2rem' }}>{p.title}</Text>
                {p.archetype && (
                  <span style={{ alignSelf: 'flex-start', fontSize: '12px', padding: '2px 8px', borderRadius: '12px', backgroundColor: 'var(--color-bg-subtle)', color: 'var(--color-text-secondary)' }}>
                    {p.archetype}
                  </span>
                )}
                {p.reasoning && <Text type="supporting" color="secondary" style={{ fontStyle: 'italic' }}>{p.reasoning}</Text>}
                <Text type="body" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {p.summary || p.shortSummary || p.draft}
                </Text>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Archetype UI Templates
// -----------------------------------------------------------------------------

function SummaryCard({ summary, nextSteps, metaAnalysis, project, sourceNotes }: { summary?: string, nextSteps?: string[], metaAnalysis?: any, project?: any, sourceNotes?: any[] }) {
  if (!summary && (!nextSteps || nextSteps.length === 0) && !metaAnalysis && !project?.createdAt) return null;
  
  const timespan = metaAnalysis?.timespan;
  const placesVisited = metaAnalysis?.placesVisited;
  const keyTakeaways = metaAnalysis?.keyTakeaways;
  const interestingOpportunities = metaAnalysis?.interestingOpportunities;

  let dateRangeStr = '';
  if (sourceNotes && sourceNotes.length > 0) {
    const dates = sourceNotes
      .map(n => n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt ? new Date(n.createdAt) : null))
      .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    if (dates.length === 1) {
      const d = dates[0];
      dateRangeStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    } else if (dates.length > 1) {
      const d1 = dates[0];
      const d2 = dates[dates.length - 1];
      const date1 = d1.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const time1 = d1.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const date2 = d2.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
      const time2 = d2.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      if (date1 === date2) {
        dateRangeStr = `${date1} · ${time1} – ${time2}`;
      } else {
        dateRangeStr = `${date1} (${time1}) – ${date2} (${time2})`;
      }
    }
  }
  if (!dateRangeStr && project?.createdAt?.toDate) {
    const d = project.createdAt.toDate();
    dateRangeStr = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' · ' + d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
      {summary && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px' }}>
          <Text type="label" color="secondary" style={{ marginBottom: '8px', display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.75rem', fontWeight: 600 }}>Executive Summary</Text>
          <Text type="body" style={{ fontSize: '1.05rem', lineHeight: 1.6, color: 'var(--color-text-primary)', display: 'block' }}>{summary}</Text>
        </Card>
      )}

      {(timespan || dateRangeStr || (placesVisited && placesVisited.length > 0)) && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
          {(timespan || dateRangeStr) && (
            <Card style={{ padding: '20px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
              <Text type="label" color="secondary" style={{ marginBottom: '8px', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', display: 'block', fontWeight: 600 }}>
                Timespan & Scope
              </Text>
              {timespan && <Text type="body" style={{ fontWeight: 500, fontSize: '0.95rem', color: 'var(--color-text-primary)', display: 'block', marginBottom: dateRangeStr ? '10px' : '0' }}>{timespan}</Text>}
              {dateRangeStr && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '4px 10px', borderRadius: '6px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', fontSize: '0.82rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                  <span>{dateRangeStr}</span>
                </div>
              )}
            </Card>
          )}
          {placesVisited && placesVisited.length > 0 && (
            <Card style={{ padding: '20px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
              <Text type="label" color="secondary" style={{ marginBottom: '10px', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', display: 'block', fontWeight: 600 }}>
                Places & Settings
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {placesVisited.map((place: string, idx: number) => (
                  <a
                    key={idx}
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '5px 12px',
                      borderRadius: '16px',
                      backgroundColor: 'var(--color-bg-subtle)',
                      border: '1px solid var(--color-border-subtle)',
                      fontSize: '0.85rem',
                      color: 'var(--color-text-primary)',
                      fontWeight: 500,
                      textDecoration: 'none',
                      transition: 'all 0.2s ease',
                      cursor: 'pointer'
                    }}
                    title={`Open "${place}" in Google Maps`}
                  >
                    <span>{place}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginLeft: '2px' }}>↗</span>
                  </a>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {keyTakeaways && keyTakeaways.length > 0 && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ marginBottom: '12px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
            Key Takeaways So Far
          </Text>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
            {keyTakeaways.map((takeaway: string, idx: number) => (
              <li key={idx}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{takeaway}</Text></li>
            ))}
          </ul>
        </Card>
      )}

      {interestingOpportunities && interestingOpportunities.length > 0 && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ marginBottom: '12px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
            Interesting Opportunities & Suggestions
          </Text>
          <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-text-primary)' }}>
            {interestingOpportunities.map((opp: string, idx: number) => (
              <li key={idx}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{opp}</Text></li>
            ))}
          </ul>
        </Card>
      )}

      {nextSteps && nextSteps.length > 0 && (
        <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
          <Text type="label" color="secondary" style={{ marginBottom: '12px', display: 'block', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '0.05em', fontWeight: 600 }}>
            Actionable Next Steps
          </Text>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--color-text-primary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {nextSteps.map((step, i) => (
              <li key={i}><Text type="body" style={{ lineHeight: 1.5, display: 'block' }}>{step}</Text></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DiaryTemplate({ content }: { content: any }) {
  if (!content) return null;
  if (content.narrativeOverview) {
    return (
      <Card style={{ padding: '24px', backgroundColor: 'var(--color-bg-elevated)', borderRadius: '12px', border: '1px solid var(--color-border-subtle)' }}>
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



function ProjectDetailScreen({ project, onBack }: { project: any, onBack: () => void }) {
  const [sourceNotes, setSourceNotes] = useState<any[]>([]);
  const [showMeeting, setShowMeeting] = useState(false);
  const [status, setStatus] = useState(project.status || 'accepted');

  const acceptProject = async () => {
    try {
      await updateDoc(doc(db, 'projects', project.id), { status: 'accepted' });
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
      const notes = [];
      const sourceIds = project.sourceNoteIds || [];
      for (const id of sourceIds) {
        try {
          const docRef = doc(db, 'notes', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            notes.push({ id: docSnap.id, ...docSnap.data() });
          }
        } catch (e) {}
      }
      setSourceNotes(notes);
    };
    fetchNotes();
  }, [project]);

  if (showMeeting) {
    return <MeetingScreen project={project} onBack={() => setShowMeeting(false)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ paddingBottom: '20px', borderBottom: '1px solid var(--color-border-subtle)', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="ghost" label="Back to Inbox" onClick={onBack} size="sm" />
        <Button 
          variant="ghost" 
          label="Delete Project" 
          onClick={async () => {
            if (!confirm('Are you sure you want to delete this project? Your original voice recordings will remain safely stored in Memory.')) return;
            try {
              if (project.sourceNoteIds && Array.isArray(project.sourceNoteIds)) {
                await Promise.all(project.sourceNoteIds.map((id: string) => updateDoc(doc(db, 'notes', id), { projectId: null })));
              }
              await deleteDoc(doc(db, 'projects', project.id));
              onBack();
            } catch (err: any) {
              alert("Error deleting project: " + err.message);
            }
          }} 
          style={{ color: 'var(--color-destructive, #ff4444)', fontWeight: 500 }} 
        />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '32px' }}>
      {status === 'proposed' && (
        <Card style={{ padding: '20px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', borderRadius: '12px' }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
          {project.archetype && (
            <div>
              <span style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', padding: '4px 10px', borderRadius: '14px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}>
                {project.archetype}
              </span>
            </div>
          )}
          <Text type="body" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2, display: 'block', letterSpacing: '-0.01em' }}>
            {project.title}
          </Text>
        </div>

        {/* Universal Executive Summary & Meta-Analysis block */}
        <SummaryCard summary={project.summary} nextSteps={project.nextSteps} metaAnalysis={project.metaAnalysis || project.content?.metaAnalysis} project={project} sourceNotes={sourceNotes} />

        {/* Dynamic content rendering based on archetype or legacy draft */}
        <div style={{ marginTop: '24px' }}>
          {project.archetype === 'Diary' && project.content ? <DiaryTemplate content={project.content} /> :
           project.archetype === 'Chapters' && project.content ? <ChaptersTemplate content={project.content} /> :
           project.archetype === 'Brainstorm' && project.content ? <BrainstormTemplate content={project.content} /> :
           <Card style={{ padding: '16px', backgroundColor: 'var(--color-bg-elevated)' }}>
             <Text type="body" style={{ whiteSpace: 'pre-wrap' }}>{project.draft || JSON.stringify(project.content, null, 2)}</Text>
           </Card>
          }
        </div>
      </div>

      {sourceNotes.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary)', fontWeight: 'bold', marginBottom: '8px', padding: '8px 0', outline: 'none' }}>
            View Source Notes ({sourceNotes.length})
          </summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            {sourceNotes.map(note => (
              <Card key={note.id} style={{ padding: '12px' }}>
                <Text type="supporting" color="secondary" style={{ textTransform: 'uppercase', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{note.category}</span>
                  <span style={{ textTransform: 'none' }}>
                    {note.createdAt?.toDate ? note.createdAt.toDate().toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : ''}
                    {note.locationString ? ` • ${note.locationString}` : ''}
                  </span>
                </Text>
                <Text type="body">{note.text}</Text>
              </Card>
            ))}
          </div>
        </details>
      )}

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '24px', paddingBottom: '24px' }}>
        <Button variant="primary" label="Consult Expert" onClick={() => setShowMeeting(true)} style={{ width: '100%' }} />
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
        { role: 'user', parts: [{ text: `We are having a meeting about my project titled "${project.title}". Archetype: ${project.archetype}. Current content: ${JSON.stringify(project.content || project.draft)}\n\nAct as a helpful project expert and consultant. Let's brainstorm and discuss the project.` }] },
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
      const replyText = result.response.text();
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
      const prompt = `Based on the following meeting transcript, propose an updated project content for the project titled "${project.title}" (Archetype: ${project.archetype}). Current content: ${JSON.stringify(project.content || project.draft)}.
      
      Return ONLY a JSON object matching the archetype schema representing the new project content. If no changes are needed, return the exact same content.
      
      Transcript:
      ${transcriptText}`;
      
      const result = await model.generateContent([prompt]);
      const jsonStr = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
      const updatedContent = JSON.parse(jsonStr);
      setProposedChanges(updatedContent);
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
      await updateDoc(doc(db, 'projects', project.id), { content: proposedChanges });
      project.content = proposedChanges; 
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
        <div style={{ padding: '24px', flex: 1, overflowY: 'auto' }}>
          <Text type="display-3" style={{ marginBottom: '16px' }}>Meeting Summary</Text>
          <Text type="body" style={{ marginBottom: '24px' }}>The expert has proposed the following updates based on your conversation.</Text>
          <Card style={{ padding: '16px', backgroundColor: 'var(--color-bg-elevated)', marginBottom: '24px' }}>
            <pre style={{ whiteSpace: 'pre-wrap', wordWrap: 'break-word', fontSize: '12px' }}>
              {JSON.stringify(proposedChanges, null, 2)}
            </pre>
          </Card>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button variant="primary" label="Apply Changes" onClick={applyChanges} />
            <Button variant="destructive" label="Discard Changes" onClick={discardChanges} />
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
                  padding: '12px', 
                  backgroundColor: c.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-elevated)', 
                  borderRadius: '12px',
                  border: c.role === 'user' ? 'none' : '1px solid var(--color-border-subtle)',
                  maxWidth: '85%' 
                }}>
                  <Text type="body" style={{ color: c.role === 'user' ? 'white' : 'inherit' }}>{c.text}</Text>
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
    
    setOrchestratorState('idle'); // waiting
    
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

  return { orchestratorState, handleNoteAdded };
}

function OrchestratorStatus({ state }: { state: string }) {
  let text = '';
  let color = 'var(--color-text-secondary)';
  let dotColor = 'transparent';
  
  switch (state) {
    case 'processing':
      text = 'AI is thinking...';
      color = 'var(--color-warning)';
      dotColor = 'var(--color-warning)';
      break;
    case 'completed':
      text = 'New project proposed!';
      color = 'var(--color-success)';
      dotColor = 'var(--color-success)';
      break;
    case 'idle':
    default:
      return null; // Don't show anything when idle to avoid clutter
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color, fontWeight: 500 }}>
      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: dotColor, animation: state === 'processing' ? 'pulse 1.5s infinite' : 'none' }} />
      {text}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState('capture');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState<any | null>(null);

  const { orchestratorState, handleNoteAdded } = useOrchestrator(user);
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

      {view === 'capture' && user && <CaptureScreen user={user} onNoteAdded={handleNoteAdded} />}
      {view === 'projects' && user && !selectedProject && <InboxScreen user={user} onSelectProject={setSelectedProject} orchestratorState={orchestratorState} />}
      {view === 'projects' && user && selectedProject && <ProjectDetailScreen project={selectedProject} onBack={() => setSelectedProject(null)} />}
    </div>
  );
}

function CaptureScreen({ user, onNoteAdded }: { user: User, onNoteAdded: () => void }) {
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
        try {
          await processAudio(audioBlob);
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
            <MemoryScreen user={user} />
          </div>
        )}
      </div>
    </Center>
  );
}

function MemoryScreen({ user }: { user: User }) {
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
    try {
      const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
      await orchestrateNotesFn({ action: 'manual', noteIds: Array.from(selectedIds) });
      setSelectedIds(new Set());
      alert('Project proposal created successfully!');
    } catch (e) {
      console.error(e);
      alert('Error creating project proposal');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleAddToExisting = async (targetProject: any) => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    try {
      const idsArray = Array.from(selectedIds);
      const orchestrateNotesFn = httpsCallable(functions, 'orchestrateNotes');
      await orchestrateNotesFn({ action: 'append_to_existing', targetProjectId: targetProject.id, noteIds: idsArray });
      setSelectedIds(new Set());
      setShowProjectSelector(false);
      alert(`Notes synthesized and added to project "${targetProject.title}"!`);
    } catch (err: any) {
      console.error(err);
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
