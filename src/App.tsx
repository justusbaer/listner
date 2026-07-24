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

  return (
    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="display-2" style={{ fontWeight: "bold" }}>Projects</Text>
        <OrchestratorStatus state={orchestratorState} />
      </div>

      {projects.length === 0 ? (
        <Center><Text type="supporting" color="secondary">No projects yet. Go to the Capture tab and "View Recent Captures" to select notes and start a new project.</Text></Center>
      ) : (
        projects.map(p => (
          <Card key={p.id} style={{ padding: '16px', cursor: 'pointer', borderLeft: p.status === 'proposed' ? '4px solid var(--color-warning)' : '4px solid var(--color-primary)' }} onClick={() => onSelectProject(p)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text type="label" color="primary">{p.status === 'proposed' ? 'Project Proposal' : 'Active Project'}</Text>
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
  );
}

// -----------------------------------------------------------------------------
// Archetype UI Templates
// -----------------------------------------------------------------------------

function SummaryCard({ summary, nextSteps }: { summary?: string, nextSteps?: string[] }) {
  if (!summary && (!nextSteps || nextSteps.length === 0)) return null;
  return (
    <Card style={{ padding: '16px', backgroundColor: 'var(--color-bg-elevated)', borderLeft: '4px solid var(--color-primary)' }}>
      {summary && (
        <div style={{ marginBottom: nextSteps?.length ? '16px' : '0' }}>
          <Text type="label" color="primary" style={{ marginBottom: '4px', display: 'block' }}>Summary</Text>
          <Text type="body">{summary}</Text>
        </div>
      )}
      {nextSteps && nextSteps.length > 0 && (
        <div>
          <Text type="label" color="primary" style={{ marginBottom: '4px', display: 'block' }}>Next Steps</Text>
          <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--color-text-primary)' }}>
            {nextSteps.map((step, i) => (
              <li key={i}><Text type="body">{step}</Text></li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function DiaryTemplate({ content }: { content: any }) {
  if (!content || !content.entries) return <Text type="body">Invalid Diary Content</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', position: 'relative' }}>
      <div style={{ position: 'absolute', left: '16px', top: '0', bottom: '0', width: '2px', backgroundColor: 'var(--color-border-subtle)' }} />
      {content.entries.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', gap: '16px', position: 'relative' }}>
          <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'var(--color-primary)', alignSelf: 'flex-start', marginTop: '6px', zIndex: 1, marginLeft: '11px' }} />
          <Card style={{ padding: '16px', flex: 1 }}>
            <Text type="label" color="secondary" style={{ marginBottom: '8px', display: 'block' }}>{entry.date}</Text>
            <Text type="body">{entry.text}</Text>
          </Card>
        </div>
      ))}
    </div>
  );
}


function ChaptersTemplate({ content }: { content: any }) {
  if (!content || !content.chapters) return <Text type="body">Invalid Chapters Content</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {content.chapters.map((chapter: any, i: number) => (
        <div key={i}>
          <Text type="body" style={{ fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '8px' }}>{chapter.heading}</Text>
          <Text type="body" style={{ whiteSpace: 'pre-wrap' }}>{chapter.body}</Text>
        </div>
      ))}
    </div>
  );
}


function BrainstormTemplate({ content }: { content: any }) {
  if (!content) return <Text type="body">Invalid Brainstorm Content</Text>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {content.thesis && (
        <Card style={{ padding: '16px', backgroundColor: 'var(--color-primary)', color: 'white' }}>
          <Text type="label" style={{ color: 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>Thesis</Text>
          <Text type="body" style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{content.thesis}</Text>
        </Card>
      )}
      
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <Card style={{ padding: '16px', borderTop: '4px solid var(--color-success, #2e7d32)' }}>
          <Text type="label" style={{ marginBottom: '8px', display: 'block' }}>Pros</Text>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {content.pros?.map((pro: string, i: number) => <li key={i}><Text type="body">{pro}</Text></li>)}
          </ul>
        </Card>
        <Card style={{ padding: '16px', borderTop: '4px solid var(--color-destructive)' }}>
          <Text type="label" style={{ marginBottom: '8px', display: 'block' }}>Cons</Text>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {content.cons?.map((con: string, i: number) => <li key={i}><Text type="body">{con}</Text></li>)}
          </ul>
        </Card>
      </div>

      {content.ideas && content.ideas.length > 0 && (
        <Card style={{ padding: '16px' }}>
          <Text type="label" color="primary" style={{ marginBottom: '8px', display: 'block' }}>Generated Ideas</Text>
          <ul style={{ margin: 0, paddingLeft: '20px' }}>
            {content.ideas.map((idea: string, i: number) => <li key={i}><Text type="body">{idea}</Text></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}



function ProjectDetailScreen({ project, onBack }: { project: any, onBack: () => void }) {
  const [sourceNotes, setSourceNotes] = useState<any[]>([]);
  const [chatLog, setChatLog] = useState<{role: string, text: string}[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState(project.status || 'accepted');
  const chatSession = useRef<any>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

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

    chatSession.current = model.startChat({
      history: [
        { role: 'user', parts: [{ text: `We are discussing a project titled "${project.title}". The current draft is:\n${project.draft}` }] },
        { role: 'model', parts: [{ text: 'Understood. How can I help refine this project?' }] }
      ]
    });
    setChatLog([{ role: 'model', text: 'Understood. How can I help refine this project?' }]);
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
      
      // Text-to-Speech playback
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(replyText);
        window.speechSynthesis.speak(utterance);
      }
    } catch (e) {
      console.error(e);
    }
    setIsSending(false);
  };

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

        if (audioBlob.size > 0) {
          setIsSending(true);
          try {
            await processAudioAndSend(audioBlob);
          } finally {
            setIsSending(false);
          }
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

  const processAudioAndSend = async (blob: Blob) => {
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

      const transcriptionPrompt = `Transcribe the following audio exactly. Output only the transcription, nothing else.`;
      const transcriptionResult = await model.generateContent([transcriptionPrompt, inlineData]);
      const transcribedText = transcriptionResult.response.text().trim();
      
      if (transcribedText) {
        await sendTextMessage(transcribedText);
      }
    } catch (e) {
      console.error("Transcription error: ", e);
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ paddingBottom: '16px' }}>
        <Button variant="ghost" label="← Back to Inbox" onClick={onBack} size="sm" />
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '24px', paddingBottom: '24px' }}>
      {status === 'proposed' && (
        <Card style={{ padding: '16px', backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-warning)' }}>
          <Text type="label" color="primary" style={{ marginBottom: '8px', display: 'block' }}>Project Proposal</Text>
          <Text type="body" style={{ marginBottom: '16px' }}>
            The Orchestrator has proposed this project. You can accept it to keep it, discard it, or use the chat below to adjust the scope first.
          </Text>
          <div style={{ display: 'flex', gap: '12px' }}>
            <Button variant="primary" label="Accept Project" onClick={acceptProject} />
            <Button variant="destructive" label="Discard Proposal" onClick={discardProject} />
          </div>
        </Card>
      )}

      <div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
          <Text type="body" style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>{project.title}</Text>
          {project.archetype && (
            <span style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '12px', backgroundColor: 'var(--color-bg-elevated)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}>
              {project.archetype}
            </span>
          )}
        </div>

        {/* Universal Summary & Next Steps block */}
        <SummaryCard summary={project.summary} nextSteps={project.nextSteps} />

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

      <div style={{ borderTop: '1px solid var(--color-border-subtle)', paddingTop: '24px' }}>
        <Text type="label" color="primary" style={{ marginBottom: '16px', display: 'block' }}>Discuss with Expert</Text>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
          {chatLog.map((c, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: c.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '100%' }}>
              <Text type="label" color="secondary" style={{ marginBottom: '4px' }}>
                {c.role === 'user' ? 'You' : 'Project Expert'}
              </Text>
              <Card style={{ padding: '12px', backgroundColor: c.role === 'user' ? 'var(--color-primary)' : 'var(--color-bg-elevated)', maxWidth: '85%' }}>
                <Text type="body" style={{ color: c.role === 'user' ? 'white' : 'inherit' }}>{c.text}</Text>
              </Card>
            </div>
          ))}
        </div>
      </div>

      </div>

      <div style={{ 
        paddingTop: '16px', 
        borderTop: '1px solid var(--color-border-subtle)', 
        backgroundColor: 'var(--color-bg)',
        zIndex: 10
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', alignItems: 'center' }}>
          <Button 
            variant={isRecording ? 'destructive' : 'primary'} 
            size="lg"
            label={isRecording ? 'Tap to Stop' : isSending ? 'Transcribing & Thinking...' : 'Tap to Record Message'}
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
      setStatus('Saved! ✅');
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
      await orchestrateNotesFn({ action: 'start_new', noteIds: Array.from(selectedIds) });
      setSelectedIds(new Set());
      alert('Project successfully created!');
    } catch (e) {
      console.error(e);
      alert('Error creating project');
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
        <div style={{ position: 'sticky', bottom: 16, background: 'var(--color-bg-subtle)', padding: '16px', borderRadius: '12px', display: 'flex', gap: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <Button onClick={handleStartProject} isDisabled={isProcessing} label={isProcessing ? 'Processing...' : 'Start New Project'} />
          <Button variant="secondary" isDisabled={isProcessing} onClick={() => alert('Add to existing project coming soon!')} label="Add to Existing" />
        </div>
      )}
    </div>
  );
}
