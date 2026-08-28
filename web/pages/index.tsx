import { useState } from "react";

export default function Home() {
  const [text, setText] = useState("");

  return (
    <main style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
      <h1>youbet.space — Create a friendly wager</h1>
      <p>Natural-language input (TypeScript prototype):</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} cols={60} />
      <div style={{ marginTop: 12 }}>
        <button onClick={async () => {
          const api = process.env.NEXT_PUBLIC_API_URL || '';
          try {
            const res = await fetch(`${api}/parse`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
            const json = await res.json();
            if (json.ok) alert('Parsed: ' + JSON.stringify(json.parsed));
            else alert('Parse error: ' + (json.error || 'unknown'));
          } catch (e: any) {
            alert('Exception: ' + String(e.message || e));
          }
        }}>Parse & Create</button>
      </div>
      <div style={{ marginTop: 24 }}>
        <h2>Deploy Factory (test)</h2>
        <DeployForm />
      </div>
      <div style={{ marginTop: 24 }}>
        <h2>Invite via SMS</h2>
        <InviteForm />
      </div>
    </main>
  );
}

function DeployForm() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleDeploy() {
    setLoading(true);
    setResult(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${api}/deploy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stake: '0.01', bond: '0.001' }) });
      const json = await res.json();
      if (json.ok) setResult(json.address);
      else setResult('Error: ' + (json.error || 'unknown'));
    } catch (e: any) {
      setResult('Exception: ' + String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button onClick={handleDeploy} disabled={loading}>{loading ? 'Deploying…' : 'Deploy Factory'}</button>
      {result && <div style={{ marginTop: 8 }}>Result: {result}</div>}
    </div>
  );
}

function CreateWagerForm() {
  const [factory, setFactory] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleCreate() {
    setLoading(true);
    setResult(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${api}/factory/${factory}/create-wager`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stake: '0.01', bond: '0.001' }) });
      const json = await res.json();
      if (json.ok) setResult(json.wagerAddress || 'no address');
      else setResult('Error: ' + (json.error || 'unknown'));
    } catch (e: any) {
      setResult('Exception: ' + String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ marginTop: 12 }}>
      <input placeholder="Factory address" value={factory} onChange={(e) => setFactory(e.target.value)} style={{ width: 400 }} />
      <button onClick={handleCreate} disabled={loading || !factory} style={{ marginLeft: 8 }}>{loading ? 'Creating…' : 'Create Wager'}</button>
      {result && <div style={{ marginTop: 8 }}>Result: {result}</div>}
    </div>
  );
}

function InviteForm() {
  const [phone, setPhone] = useState('');
  const [stage, setStage] = useState<'input'|'code'|'done'>('input');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function sendInvite() {
    setMessage(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${api}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
      const json = await res.json();
      if (json.ok) {
        setStage('code');
        setMessage('OTP sent (check SMS or console in dev)');
      } else setMessage('Error: ' + (json.error || 'unknown'));
    } catch (e: any) {
      setMessage('Exception: ' + String(e.message || e));
    }
  }

  async function verify() {
    setMessage(null);
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${api}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) });
      const json = await res.json();
      if (json.ok) {
        setStage('done');
        setMessage('Verified — you can participate now');
      } else setMessage('Error: ' + (json.error || 'unknown'));
    } catch (e: any) {
      setMessage('Exception: ' + String(e.message || e));
    }
  }

  return (
    <div>
      {stage === 'input' && (
        <div>
          <input placeholder="+15555551234" value={phone} onChange={(e) => setPhone(e.target.value)} style={{ width: 240 }} />
          <button onClick={sendInvite} style={{ marginLeft: 8 }}>Send OTP</button>
        </div>
      )}
      {stage === 'code' && (
        <div style={{ marginTop: 8 }}>
          <input placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 160 }} />
          <button onClick={verify} style={{ marginLeft: 8 }}>Verify</button>
        </div>
      )}
      {stage === 'done' && (
        <div>Verified for {phone}</div>
      )}
      {message && <div style={{ marginTop: 8 }}>{message}</div>}
    </div>
  );
}
