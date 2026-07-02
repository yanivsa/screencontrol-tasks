import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

function playSound(type) {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    if (type === 'success') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.exponentialRampToValueAtTime(783.99, now + 0.12);
      osc.frequency.exponentialRampToValueAtTime(1046.50, now + 0.25);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.3, now + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.45);
    } else if (type === 'error') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, now);
      osc.frequency.linearRampToValueAtTime(100, now + 0.2);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.linearRampToValueAtTime(0.001, now + 0.2);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.2);
    } else if (type === 'click') {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc.connect(gain); gain.connect(audioCtx.destination);
      osc.start(now); osc.stop(now + 0.06);
    }
  } catch (err) {}
}

function ConfettiParticles() {
  const [particles, setParticles] = useState([]);
  useEffect(() => {
    const arr = [];
    const colors = ['#3b82f6', '#10b981', '#a855f7', '#f59e0b', '#ef4444', '#ec4899'];
    for (let i = 0; i < 60; i++) {
      arr.push({
        id: i, x: Math.random() * 100, y: Math.random() * 30 - 20,
        size: Math.random() * 8 + 6, color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 0.5, duration: Math.random() * 1.5 + 1.5, rotation: Math.random() * 360,
      });
    }
    setParticles(arr);
    const timer = setTimeout(() => setParticles([]), 3500);
    return () => clearTimeout(timer);
  }, []);
  if (particles.length === 0) return null;
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      {particles.map(p => (
        <div key={p.id} style={{
          position: 'absolute', left: `${p.x}%`, top: `${p.y}%`, width: `${p.size}px`, height: `${p.size}px`,
          backgroundColor: p.color, borderRadius: Math.random() > 0.5 ? '50%' : '2px',
          transform: `rotate(${p.rotation}deg)`, opacity: 0.8,
          animation: `fall ${p.duration}s linear ${p.delay}s forwards`,
        }} />
      ))}
      <style>{`@keyframes fall { 0% { top: -5%; transform: translateY(0) rotate(0deg); } 100% { top: 105%; transform: translateY(100vh) rotate(720deg); } }`}</style>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('app_token'));
  const [pinTarget, setPinTarget] = useState(null);
  const [pinInput, setPinInput] = useState('');
  const [error, setError] = useState('');
  const [children, setChildren] = useState([]);
  const [triggerConfetti, setTriggerConfetti] = useState(false);

  const [parentTab, setParentTab] = useState('dashboard');
  const [childTab, setChildTab] = useState('dashboard');

  const [tasks, setTasks] = useState([]);
  const [taskTemplates, setTaskTemplates] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [screenRequests, setScreenRequests] = useState([]);
  const [wallet, setWallet] = useState({ child: null, stats: { earned_today: 0, spent_today: 0 } });

  const [stats, setStats] = useState({});
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showScreenRequestModal, setShowScreenRequestModal] = useState(false);
  const [showManualLogModal, setShowManualLogModal] = useState(false);
  const [showProposeModal, setShowProposeModal] = useState(false);

  const [newTask, setNewTask] = useState({ title: '', description: '', rewardMinutes: 15, assignedChildIds: [], scheduleType: 'one_time', requiresPhoto: false });
  const [adjustData, setAdjustData] = useState({ childId: '', minutes: 10, type: 'earn', reason: '' });
  const [manualLogData, setManualLogData] = useState({ childId: '', minutes: 20, source: 'טלוויזיה', reason: '' });
  const [screenRequestData, setScreenRequestData] = useState({ minutes: 15, source: 'טלוויזיה' });
  const [proposeData, setProposeData] = useState({ title: '', description: '', rewardMinutes: 15 });
  const [submissionPhoto, setSubmissionPhoto] = useState(null);
  const [submissionNote, setSubmissionNote] = useState('');
  const [selectedTaskForSubmission, setSelectedTaskForSubmission] = useState(null);

  const apiFetch = async (path, options = {}) => {
    const headers = { ...options.headers };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return fetch(`${API_BASE}${path}`, { ...options, headers });
  };

  useEffect(() => {
    const savedToken = localStorage.getItem('app_token');
    if (savedToken) {
      try {
        const binaryStr = atob(savedToken);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const jsonStr = new TextDecoder().decode(bytes);
        const payload = JSON.parse(jsonStr);
        if (payload && payload.exp > Date.now()) {
          setCurrentUser(payload);
          setToken(savedToken);
        } else {
          localStorage.removeItem('app_token');
        }
      } catch (e) {
        localStorage.removeItem('app_token');
      }
    }
  }, []);

  useEffect(() => {
    fetchChildren();
  }, [token, currentUser]);

  const fetchChildren = async () => {
    try {
      // Fetch detailed child details if logged in as parent, else fetch public profiles list
      const path = (currentUser && currentUser.role === 'parent') ? '/api/children/details' : '/api/children';
      const res = await apiFetch(path);
      if (res.ok) setChildren(await res.json());
    } catch (err) {}
  };

  useEffect(() => {
    if (!currentUser) return;
    const loadData = () => {
      if (currentUser.role === 'parent') {
        fetchTasks();
        fetchNotifications('parent');
        fetchChildren();
        fetchTaskTemplates();
        fetchScreenRequests();
        fetchStats();
      } else {
        fetchWallet(currentUser.id);
        fetchTasks(currentUser.id);
        fetchNotifications('child', currentUser.id);
        fetchScreenRequests(currentUser.id);
      }
    };
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [currentUser]);

  const fetchStats = async () => {
    try {
      const res = await apiFetch(`/api/dashboard/stats`);
      if (res.ok) setStats(await res.json());
    } catch (err) {}
  };

  const fetchWallet = async (childId) => {
    try {
      const res = await apiFetch(`/api/children/${childId}/wallet`);
      if (res.ok) setWallet(await res.json());
    } catch (err) {}
  };

  const fetchTaskTemplates = async () => {
    try {
      const res = await apiFetch(`/api/task-templates`);
      if (res.ok) setTaskTemplates(await res.json());
    } catch (err) {}
  };

  const fetchTasks = async (childId = '') => {
    try {
      const query = childId ? `?childId=${childId}` : '';
      const res = await apiFetch(`/api/tasks${query}`);
      if (res.ok) setTasks(await res.json());
    } catch (err) {}
  };

  const fetchScreenRequests = async (childId = '') => {
    try {
      const query = childId ? `?childId=${childId}` : '';
      const res = await apiFetch(`/api/screen-time-requests${query}`);
      if (res.ok) setScreenRequests(await res.json());
    } catch (err) {}
  };

  const fetchNotifications = async (type, childId = '') => {
    try {
      const query = childId ? `?recipientType=child&recipientId=${childId}` : '?recipientType=parent';
      const res = await apiFetch(`/api/notifications${query}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data);
        const unreadIds = data.filter(n => !n.read_at).map(n => n.id);
        if (unreadIds.length > 0) {
          apiFetch(`/api/notifications/read`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notificationIds: unreadIds })
          });
        }
      }
    } catch (err) {}
  };

  const handleKeyPress = (num) => {
    playSound('click');
    if (pinInput.length < 4) {
      const newVal = pinInput + num;
      setPinInput(newVal);
      if (newVal.length === 4) submitLogin(newVal);
    }
  };

  const submitLogin = async (pin) => {
    try {
      const role = pinTarget === 'parent' ? 'parent' : 'child';
      const childId = pinTarget !== 'parent' ? pinTarget : null;
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, pin, childId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        playSound('success');
        setCurrentUser(data.user);
        setToken(data.token);
        localStorage.setItem('app_token', data.token);
        setPinTarget(null); setPinInput(''); setError('');
      } else {
        playSound('error');
        setError(data.error || 'קוד שגוי');
        setPinInput('');
      }
    } catch (err) {
      playSound('error');
      setError('בעיית תקשורת בשרת');
      setPinInput('');
    }
  };

  const handleLogout = () => {
    playSound('click');
    setCurrentUser(null);
    setToken(null);
    localStorage.removeItem('app_token');
    setPinTarget(null); setPinInput(''); setError('');
  };

  const handleCreateTask = async (e) => {
    e.preventDefault();
    try {
      let res;
      if (newTask.scheduleType === 'one_time') {
        for (const childId of newTask.assignedChildIds) {
          res = await apiFetch(`/api/task-instances`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ childId, ...newTask })
          });
        }
      } else {
        res = await apiFetch(`/api/task-templates`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultRewardMinutes: newTask.rewardMinutes, ...newTask })
        });
      }
      if (res && res.ok) {
        playSound('success'); setShowAddTaskModal(false);
        setNewTask({ title: '', description: '', rewardMinutes: 15, assignedChildIds: [], scheduleType: 'one_time', requiresPhoto: false });
        fetchTasks(); fetchTaskTemplates();
      }
    } catch (err) {}
  };

  const handleTaskSubmit = async (e) => {
    e.preventDefault();
    if (!selectedTaskForSubmission) return;
    try {
      const res = await apiFetch(`/api/task-instances/${selectedTaskForSubmission.id}/submit`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: submissionNote, photoBase64: submissionPhoto })
      });
      if (res.ok) {
        playSound('success');
        setSelectedTaskForSubmission(null); setSubmissionNote(''); setSubmissionPhoto(null);
        fetchTasks(currentUser.id);
      } else {
        alert((await res.json()).error);
      }
    } catch (err) {}
  };

  const handleApprove = async (instanceId) => {
    const res = await apiFetch(`/api/task-instances/${instanceId}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      playSound('success'); setTriggerConfetti(true); setTimeout(() => setTriggerConfetti(false), 3500); fetchTasks();
    }
  };

  const handleReject = async (instanceId) => {
    const reason = prompt('סיבת הדחייה:');
    if (reason === null) return;
    const res = await apiFetch(`/api/task-instances/${instanceId}/reject`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason })
    });
    if (res.ok) { playSound('error'); fetchTasks(); }
  };

  const handleAdjustWallet = async (e) => {
    e.preventDefault();
    // Pre-flight confirm warning if deduction drives balance below -60
    const selectedChild = children.find(c => c.id === adjustData.childId);
    if (selectedChild) {
      const currentBalance = selectedChild.available_minutes || 0;
      let change = parseInt(adjustData.minutes);
      if (adjustData.type === 'spend') change = -change;
      const expectedBalance = currentBalance + change;
      if (expectedBalance < -60) {
        if (!confirm(`שים לב: יתרת הילד תרד ל-${expectedBalance} דקות (חריגה מסף חוב של -60). האם להמשיך?`)) {
          return;
        }
      }
    }

    const res = await apiFetch(`/api/manual-adjustment`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(adjustData)
    });
    if (res.ok) {
      playSound('success'); setShowAdjustModal(false);
      fetchChildren();
    } else {
      alert((await res.json()).error);
    }
  };

  const handleScreenRequest = async (e) => {
    e.preventDefault();
    const res = await apiFetch(`/api/screen-time-requests`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestedMinutes: screenRequestData.minutes, source: screenRequestData.source })
    });
    if (res.ok) {
      playSound('success'); setShowScreenRequestModal(false); fetchScreenRequests(currentUser.id);
    } else alert((await res.json()).error);
  };

  const handleApproveScreenRequest = async (req) => {
    const userVal = prompt(`כמה דקות לאשר עבור ${req.child_id === 'uri' ? 'אורי' : 'איתן'}?`, req.requested_minutes);
    if (userVal === null) return; // cancelled
    const minutes = parseInt(userVal);

    const res = await apiFetch(`/api/screen-time-requests/${req.id}/approve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvedMinutes: minutes })
    });
    if (res.ok) { playSound('success'); fetchScreenRequests(); fetchChildren(); }
  };

  const handleReviewProposed = async (instanceId, action, rewardMinutesOverride) => {
    const res = await apiFetch(`/api/task-instances/${instanceId}/review-proposed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, rewardMinutesOverride })
    });
    if (res.ok) {
      playSound('success');
      fetchTasks();
    }
  };

  const handleProposeTask = async (e) => {
    e.preventDefault();
    const res = await apiFetch(`/api/tasks/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(proposeData)
    });
    if (res.ok) {
      playSound('success');
      setShowProposeModal(false);
      setProposeData({ title: '', description: '', rewardMinutes: 15 });
      fetchTasks(currentUser.id);
    } else {
      alert((await res.json()).error);
    }
  };

  const handleRejectScreenRequest = async (reqId) => {
    const res = await apiFetch(`/api/screen-time-requests/${reqId}/reject`, { method: 'POST' });
    if (res.ok) { playSound('error'); fetchScreenRequests(); }
  };

  const handleManualLog = async (e) => {
    e.preventDefault();
    // Pre-flight confirm warning if manual log drives balance below -60
    const selectedChild = children.find(c => c.id === manualLogData.childId);
    if (selectedChild) {
      const currentBalance = selectedChild.available_minutes || 0;
      const change = -parseInt(manualLogData.minutes);
      const expectedBalance = currentBalance + change;
      if (expectedBalance < -60) {
        if (!confirm(`שים לב: יתרת הילד תרד ל-${expectedBalance} דקות (חריגה מסף חוב של -60). האם להמשיך?`)) {
          return;
        }
      }
    }

    const res = await apiFetch(`/api/screen-usage/manual-log`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(manualLogData)
    });
    if (res.ok) {
      playSound('success'); setShowManualLogModal(false); fetchChildren();
    } else alert((await res.json()).error);
  };

  if (pinTarget) {
    const targetName = pinTarget === 'parent' ? 'הורה' : (pinTarget === 'uri' ? 'אורי' : 'איתן');
    return (
      <div className="modal-overlay">
        <div className="modal-content animated-view">
          <h2>כניסה לפרופיל</h2>
          <p style={{ color: 'var(--text-secondary)', marginTop: '8px' }}>אנא הקש קוד גישה עבור {targetName}</p>
          <div className="pin-dots">
            {[1,2,3,4].map(i => <div key={i} className={`pin-dot ${pinInput.length >= i ? 'active' : ''}`} />)}
          </div>
          <div className="pin-keyboard">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(num => <button key={num} className="pin-key" onClick={() => handleKeyPress(num)}>{num}</button>)}
            <button className="pin-key backspace" onClick={() => { playSound('click'); setPinInput(prev => prev.slice(0, -1)); }}>⌫</button>
            <button className="pin-key" onClick={() => handleKeyPress(0)}>0</button>
            <button className="pin-key" onClick={() => { setPinTarget(null); setPinInput(''); setError(''); }} style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>ביטול</button>
          </div>
          <div className="error-message">{error}</div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="profiles-screen animated-view">
        <h1 className="profiles-title">משימות וזמן מסך</h1>
        <p className="profiles-subtitle">משפחת יניב</p>
        <div className="profiles-grid">
          <div className="profile-card parent" onClick={() => setPinTarget('parent')}>
            <img src="/parent_avatar.jpg" alt="הורים" className="profile-avatar-img" />
            <div className="profile-name">הורים</div>
            <div className="profile-role">ניהול משימות</div>
          </div>
          {children.map(child => (
            <div key={child.id} className={`profile-card ${child.id}`} onClick={() => setPinTarget(child.id)}>
              <img src={child.id === 'uri' ? '/uri_avatar.jpg' : '/eitan_avatar.jpg'} alt={child.name} className="profile-avatar-img" />
              <div className="profile-name">{child.name}</div>
              <div className="profile-role">פרופיל ילד</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (currentUser.role === 'parent') {
    const pendingSubmissions = tasks.filter(t => t.status === 'submitted');
    const pendingRequests = screenRequests.filter(r => r.status === 'pending');
    
    return (
      <div className="app-container parent animated-view">
        {triggerConfetti && <ConfettiParticles />}
        <header className="app-header">
          <div className="app-title">ניהול הורים</div><div className="user-badge" onClick={handleLogout}>יציאה 👋</div>
        </header>

        {parentTab === 'dashboard' && (
          <div>
            <div className="section-title">יתרת דקות הילדים</div>
            <div className="card-list">
              {children.map(child => (
                <div key={child.id} className={`kid-summary-card ${child.id}`}>
                  <div className="kid-info">
                    <img src={child.id === 'uri' ? '/uri_avatar.jpg' : '/eitan_avatar.jpg'} alt={child.name} className="kid-avatar-img" />
                    <div className="kid-details">
                      <h3>{child.name}</h3>
                      <p style={{ fontSize: '0.8rem', color: child.available_minutes < -60 ? 'red' : 'var(--text-secondary)' }}>
                        {child.available_minutes < -60 && '⚠️ אזהרת חוב גדולה '}
                      </p>
                    </div>
                  </div>
                  <div className="kid-minutes">{child.available_minutes} דק׳</div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
              <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdjustModal(true)}>עדכון ארנק ידני</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setShowManualLogModal(true)}>רישום שימוש במסך</button>
            </div>

            {pendingRequests.length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <div className="section-title">בקשות זמן מסך ({pendingRequests.length})</div>
                <div className="card-list">
                  {pendingRequests.map(req => (
                    <div key={req.id} className="task-card" style={{ flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <span className="status-badge submitted">מאת: {req.child_id === 'uri' ? 'אורי' : 'איתן'}</span>
                          <div className="task-title">בקשה: {req.source}</div>
                        </div>
                        <div className="reward-badge">{req.requested_minutes} דק׳</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleApproveScreenRequest(req)}>אשר ✔️</button>
                        <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleRejectScreenRequest(req.id)}>דחה ❌</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasks.filter(t => t.status === 'proposed').length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <div className="section-title">הצעות משימה מהילדים ({tasks.filter(t => t.status === 'proposed').length})</div>
                <div className="card-list">
                  {tasks.filter(t => t.status === 'proposed').map(task => (
                    <div key={task.id} className="task-card" style={{ flexDirection: 'column', gap: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <div>
                          <span className="status-badge submitted">הצעה מאת: {task.child_id === 'uri' ? 'אורי' : 'איתן'}</span>
                          <div className="task-title">{task.title}</div>
                          <div className="task-desc">{task.description}</div>
                        </div>
                        <div className="reward-badge">{task.reward_minutes} דק׳</div>
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleReviewProposed(task.id, 'approve')}>אשר משימה 👍</button>
                        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => {
                          const newReward = prompt('הזן דקות תגמול מותאמות:', task.reward_minutes);
                          if (newReward !== null) handleReviewProposed(task.id, 'approve', parseInt(newReward));
                        }}>שנה דקות ✏️</button>
                        <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleReviewProposed(task.id, 'reject')}>דחה ❌</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="section-title" style={{ marginTop: '30px' }}>משימות הממתינות לאישור ({pendingSubmissions.length})</div>
            <div className="card-list">
              {pendingSubmissions.length === 0 ? <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>אין משימות לאישור</p> : 
                pendingSubmissions.map(task => (
                  <div key={task.id} className="task-card" style={{ flexDirection: 'column', gap: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <span className="status-badge submitted">מאת: {task.child_id === 'uri' ? 'אורי' : 'איתן'}</span>
                        <div className="task-title">{task.title}</div><div className="task-desc">{task.description}</div>
                        {task.submission_note && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '4px' }}>הערה: {task.submission_note}</div>}
                      </div>
                      <div className="reward-badge">{task.reward_minutes} דק׳</div>
                    </div>
                    {task.requires_photo === 1 && (
                      task.photo_deleted_at ? (
                        <div style={{ padding: '10px', backgroundColor: 'var(--bg-card)', color: 'var(--text-secondary)', borderRadius: '8px', textAlign: 'center' }}>
                          התמונה נמחקה מטעמי פרטיות 🗑️
                        </div>
                      ) : (
                        task.photo_object_key && (
                          <img src={`${API_BASE}/api/photos/${task.photo_object_key}`} alt="הוכחה" style={{ width: '100%', borderRadius: '8px' }} />
                        )
                      )
                    )}
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => handleApprove(task.id)}>אשר 🥇</button>
                      <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => handleReject(task.id)}>דחה ❌</button>
                    </div>
                  </div>
                ))
              }
            </div>

            {Object.keys(stats).length > 0 && (
              <div style={{ marginTop: '30px' }}>
                <div className="section-title">סיכום שבועי (7 ימים אחרונים) 📊</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                  {Object.entries(stats).map(([childId, childStats]) => (
                    <div key={childId} className={`task-card ${childId}`} style={{ flexDirection: 'column', padding: '15px', border: '1px solid var(--glass-border)' }}>
                      <h4 style={{ borderBottom: '1px solid var(--glass-border)', paddingBottom: '5px', marginBottom: '10px' }}>{childStats.name}</h4>
                      <div style={{ fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <div>🏅 משימות שבוצעו: <strong>{childStats.current.completed}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({childStats.previous.completed} שבוע שעבר)</span></div>
                        <div>🎁 דקות שהורווחו: <strong>{childStats.current.earned}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({childStats.previous.earned} שבוע שעבר)</span></div>
                        <div>🎮 דקות שנוצלו: <strong>{childStats.current.spent}</strong> <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>({childStats.previous.spent} שבוע שעבר)</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {parentTab === 'tasks' && (
          <div>
            <button className="btn btn-primary" onClick={() => setShowAddTaskModal(true)} style={{ marginBottom: '15px' }}>➕ הוסף משימה/תבנית</button>
            <div className="section-title">תבניות משימות קבועות</div>
            <div className="card-list">
              {taskTemplates.map(tpl => (
                <div key={tpl.id} className="task-card">
                  <div className="task-info">
                    <div className="task-title">{tpl.title}</div><div className="task-desc">{tpl.description}</div>
                  </div>
                  <div className="reward-badge">{tpl.default_reward_minutes} דק׳</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {parentTab === 'history' && (
          <div>
            <div className="section-title">היסטוריית בקשות מסך</div>
            <div className="card-list" style={{ marginBottom: '20px' }}>
              {screenRequests.filter(r => r.status !== 'pending').slice(0,10).map(req => (
                <div key={req.id} className="task-card">
                  <div>
                    <div className="task-title">{req.source} ({req.child_id === 'uri' ? 'אורי' : 'איתן'})</div>
                    <div className="task-desc">{new Date((req.reviewed_at || req.requested_at).replace(" ", "T") + "Z").toLocaleDateString('he-IL')}</div>
                  </div>
                  <span className={`status-badge ${req.status}`}>{req.status === 'approved' ? 'אושר' : 'נדחה'}</span>
                </div>
              ))}
            </div>
            <div className="section-title">היסטוריית משימות</div>
            <div className="card-list">
              {tasks.filter(t => t.status === 'approved' || t.status === 'rejected').slice(0, 10).map(task => (
                <div key={task.id} className="task-card">
                  <div className="task-info"><div className="task-title">{task.title}</div><div className="task-desc">{task.child_id === 'uri' ? 'אורי' : 'איתן'}</div></div>
                  <span className={`status-badge ${task.status}`}>{task.status === 'approved' ? 'אושר' : 'נדחה'}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <nav className="bottom-nav">
          <div className={`nav-item ${parentTab === 'dashboard' ? 'active' : ''}`} onClick={() => setParentTab('dashboard')}><span className="nav-icon">📊</span><span>דשבורד</span></div>
          <div className={`nav-item ${parentTab === 'tasks' ? 'active' : ''}`} onClick={() => setParentTab('tasks')}><span className="nav-icon">📝</span><span>משימות</span></div>
          <div className={`nav-item ${parentTab === 'history' ? 'active' : ''}`} onClick={() => setParentTab('history')}><span className="nav-icon">📜</span><span>היסטוריה</span></div>
        </nav>

        {showAddTaskModal && (
          <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
            <h3>משימה חדשה</h3>
            <form onSubmit={handleCreateTask}>
              <div className="form-group"><label className="form-label">כותרת</label><input type="text" className="form-input" required value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">ילדים</label>
                <div style={{ display:'flex', gap:'10px' }}>
                  <label><input type="checkbox" checked={newTask.assignedChildIds.includes('uri')} onChange={e => setNewTask({...newTask, assignedChildIds: e.target.checked ? [...newTask.assignedChildIds, 'uri'] : newTask.assignedChildIds.filter(x=>x!=='uri')})} /> אורי</label>
                  <label><input type="checkbox" checked={newTask.assignedChildIds.includes('eitan')} onChange={e => setNewTask({...newTask, assignedChildIds: e.target.checked ? [...newTask.assignedChildIds, 'eitan'] : newTask.assignedChildIds.filter(x=>x!=='eitan')})} /> איתן</label>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <div className="form-group"><label className="form-label">דקות</label><input type="number" className="form-input" required value={newTask.rewardMinutes} onChange={e => setNewTask({...newTask, rewardMinutes: parseInt(e.target.value)})} /></div>
                <div className="form-group"><label className="form-label">תדירות</label><select className="form-select" value={newTask.scheduleType} onChange={e => setNewTask({...newTask, scheduleType: e.target.value})}><option value="one_time">חד-פעמי</option><option value="daily">יומי</option></select></div>
              </div>
              <label><input type="checkbox" checked={newTask.requiresPhoto} onChange={e => setNewTask({...newTask, requiresPhoto: e.target.checked})} /> דורש צילום📸</label>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>שמור</button>
                <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAddTaskModal(false)}>ביטול</button>
              </div>
            </form>
          </div></div>
        )}

        {showAdjustModal && (
          <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
            <h3>עדכון ארנק ידני</h3>
            <form onSubmit={handleAdjustWallet}>
              <div className="form-group"><label className="form-label">ילד</label><select className="form-select" value={adjustData.childId} onChange={e=>setAdjustData({...adjustData, childId: e.target.value})}><option value="">בחר ילד...</option><option value="uri">אורי</option><option value="eitan">איתן</option></select></div>
              <div className="form-group"><label className="form-label">פעולה</label><select className="form-select" value={adjustData.type} onChange={e=>setAdjustData({...adjustData, type: e.target.value})}><option value="earn">הוסף 🎁</option><option value="spend">הפחת ⚠️</option></select></div>
              <div className="form-group"><label className="form-label">דקות</label><input type="number" className="form-input" required value={adjustData.minutes} onChange={e=>setAdjustData({...adjustData, minutes: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">סיבה</label><input type="text" className="form-input" required value={adjustData.reason} onChange={e=>setAdjustData({...adjustData, reason: e.target.value})} /></div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>עדכן</button><button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowAdjustModal(false)}>ביטול</button>
              </div>
            </form>
          </div></div>
        )}

        {showManualLogModal && (
          <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
            <h3>רישום ניצול מסך ידני</h3>
            <form onSubmit={handleManualLog}>
              <div className="form-group"><label className="form-label">ילד</label><select className="form-select" required value={manualLogData.childId} onChange={e=>setManualLogData({...manualLogData, childId: e.target.value})}><option value="">בחר ילד...</option><option value="uri">אורי</option><option value="eitan">איתן</option></select></div>
              <div className="form-group"><label className="form-label">מכשיר</label><select className="form-select" value={manualLogData.source} onChange={e=>setManualLogData({...manualLogData, source: e.target.value})}><option value="טלוויזיה">טלוויזיה</option><option value="סוני">סוני</option><option value="טאבלט">טאבלט</option><option value="Family Link">Family Link</option></select></div>
              <div className="form-group"><label className="form-label">דקות נוצלו</label><input type="number" className="form-input" required value={manualLogData.minutes} onChange={e=>setManualLogData({...manualLogData, minutes: e.target.value})} /></div>
              <div className="form-group"><label className="form-label">סיבה / הערה</label><input type="text" className="form-input" value={manualLogData.reason} onChange={e=>setManualLogData({...manualLogData, reason: e.target.value})} placeholder="למשל: צפייה בטלוויזיה אחרי הצהריים" /></div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>רשום</button><button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowManualLogModal(false)}>ביטול</button>
              </div>
            </form>
          </div></div>
        )}
      </div>
    );
  }

  const childThemeClass = currentUser.id === 'uri' ? 'uri' : 'eitan';
  const childOpenTasks = tasks.filter(t => t.child_id === currentUser.id && t.status === 'open');

  return (
    <div className={`app-container ${childThemeClass} animated-view`}>
      <header className="app-header"><div className="app-title">{currentUser.name}</div><div className="user-badge" onClick={handleLogout}>החלף 👤</div></header>
      {triggerConfetti && <ConfettiParticles />}

      {childTab === 'dashboard' && (
        <div>
          <div className="wallet-card">
            <div className="wallet-minutes">{wallet.child?.available_minutes || 0}</div>
            <div className="wallet-label">דקות מסך בארנק שלך ⏱️</div>
            <button className="btn btn-primary" onClick={() => setShowScreenRequestModal(true)}>🎮 בקש זמן מסך</button>
            <button className="btn btn-secondary" style={{ marginTop: '10px', width: '100%' }} onClick={() => setShowProposeModal(true)}>💡 הצע משימה להורה</button>
            <div className="wallet-stats">
              <div className="stat-item"><span className="stat-val">{wallet.stats?.earned_today || 0}</span><span className="stat-label">הרווחת היום</span></div>
              <div className="stat-item"><span className="stat-val">{wallet.stats?.spent_today || 0}</span><span className="stat-label">ניצלת היום</span></div>
            </div>
          </div>
          <div className="section-title">משימות פתוחות ({childOpenTasks.length})</div>
          <div className="card-list">
            {childOpenTasks.slice(0, 3).map(task => (
              <div key={task.id} className="task-card" onClick={() => setSelectedTaskForSubmission(task)}>
                <div className="task-info"><div className="task-title">{task.title}</div><div className="task-desc">{task.description}</div></div>
                <div className="reward-badge">+{task.reward_minutes}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {childTab === 'tasks' && (
        <div>
          <div className="section-title">היסטוריית משימות ובקשות</div>
          <div className="card-list">
            {screenRequests.map(req => (
              <div key={req.id} className="task-card">
                <div className="task-info"><div className="task-title">בקשת מסך: {req.source}</div></div>
                <span className={`status-badge ${req.status}`}>{req.status === 'pending' ? 'ממתין לאישור' : (req.status === 'approved' ? 'אושר' : 'נדחה')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <nav className="bottom-nav">
        <div className={`nav-item ${childTab === 'dashboard' ? 'active' : ''}`} onClick={() => setChildTab('dashboard')}><span className="nav-icon">🏠</span><span>בית</span></div>
        <div className={`nav-item ${childTab === 'tasks' ? 'active' : ''}`} onClick={() => setChildTab('tasks')}><span className="nav-icon">🏆</span><span>בקשות</span></div>
      </nav>

      {showScreenRequestModal && (
        <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
          <h3>בקשת זמן מסך</h3>
          <p>יתרה: {wallet.child?.available_minutes || 0} דקות.</p>
          <form onSubmit={handleScreenRequest}>
            <div className="form-group"><label className="form-label">דקות</label><select className="form-select" value={screenRequestData.minutes} onChange={e=>setScreenRequestData({...screenRequestData, minutes: parseInt(e.target.value)})}>
              {[15, 30, 45, 60].map(m => <option key={m} value={m} disabled={(wallet.child?.available_minutes || 0) < m}>{m} דקות</option>)}
            </select></div>
            <div className="form-group"><label className="form-label">מכשיר</label><select className="form-select" value={screenRequestData.source} onChange={e=>setScreenRequestData({...screenRequestData, source: e.target.value})}><option value="טלוויזיה">טלוויזיה</option><option value="סוני">סוני</option><option value="טאבלט">טאבלט</option></select></div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>שלח לאישור</button><button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowScreenRequestModal(false)}>ביטול</button>
            </div>
          </form>
        </div></div>
      )}

      {selectedTaskForSubmission && (
        <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
          <h3>הגשת משימה</h3>
          <p>{selectedTaskForSubmission.title}</p>
          <form onSubmit={handleTaskSubmit}>
            {selectedTaskForSubmission.requires_photo === 1 && (
              <div className="form-group">
                <label className="form-label">צילום 📸</label>
                <input type="file" accept="image/*" capture="environment" onChange={e => { const r = new FileReader(); r.onloadend = () => setSubmissionPhoto(r.result.split(',')[1]); r.readAsDataURL(e.target.files[0]); }} required />
              </div>
            )}
            <div className="form-group"><label className="form-label">הערה</label><input type="text" className="form-input" value={submissionNote} onChange={e => setSubmissionNote(e.target.value)} /></div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>שלח לאישור הורה</button><button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setSelectedTaskForSubmission(null)}>ביטול</button>
            </div>
          </form>
        </div></div>
      )}

      {showProposeModal && (
        <div className="modal-overlay"><div className="modal-content animated-view" style={{ textAlign: 'right' }}>
          <h3>הצעת משימה חדשה</h3>
          <form onSubmit={handleProposeTask}>
            <div className="form-group"><label className="form-label">שם המשימה</label><input type="text" className="form-input" required value={proposeData.title} onChange={e => setProposeData({...proposeData, title: e.target.value})} placeholder="למשל: שטיפת כלים של ארוחת ערב" /></div>
            <div className="form-group"><label className="form-label">פירוט (מה תעשה?)</label><input type="text" className="form-input" value={proposeData.description} onChange={e => setProposeData({...proposeData, description: e.target.value})} placeholder="למשל: אשטוף את כל הצלחות והכוסות בכיור" /></div>
            <div className="form-group"><label className="form-label">דקות תגמול מבוקשות</label><input type="number" className="form-input" required value={proposeData.rewardMinutes} onChange={e => setProposeData({...proposeData, rewardMinutes: parseInt(e.target.value)})} /></div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }}>שלח הצעת משימה</button>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setShowProposeModal(false)}>ביטול</button>
            </div>
          </form>
        </div></div>
      )}
    </div>
  );
}
