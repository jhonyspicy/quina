import { useState, type FormEvent } from "react";
import { formatRemaining, getClockView } from "@quina/clock";
import { createDevTournament } from "./api.ts";
import { SlideToStart } from "./SlideToStart.tsx";
import { useNow } from "./useNow.ts";
import { useTournament } from "./useTournament.ts";

const TOURNAMENT_PARAM = "t";

export function App() {
  const [tournamentId, setTournamentId] = useState(
    () => new URLSearchParams(location.search).get(TOURNAMENT_PARAM),
  );

  if (!tournamentId) {
    return (
      <CreateTournament
        onCreated={(id) => {
          const url = new URL(location.href);
          url.searchParams.set(TOURNAMENT_PARAM, id);
          history.replaceState(null, "", url);
          setTournamentId(id);
        }}
      />
    );
  }
  return <Remote tournamentId={tournamentId} />;
}

function CreateTournament({ onCreated }: { onCreated(id: string): void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      onCreated(await createDevTournament());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="screen">
      <h1>Quina リモコン</h1>
      <section className="card">
        <p className="note">
          開発用の画面です。ログインやストラクチャー設定の代わりに、固定のストラクチャー（20分×10レベル）で大会を作ります。
        </p>
        <button className="primary" onClick={create} disabled={busy}>
          開発用の大会を作成
        </button>
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}

function Remote({ tournamentId }: { tournamentId: string }) {
  const { status, snapshot, notFound, pairResult, remoteNumber, serverClock, send } =
    useTournament(tournamentId);
  const now = useNow(serverClock.now);
  const online = status === "open";

  if (notFound) {
    return (
      <main className="screen">
        <h1>大会が見つかりません</h1>
        <p className="note">URLを確認してください。</p>
      </main>
    );
  }

  const view = snapshot && getClockView(snapshot.clock, snapshot.structure, now);

  return (
    <main className="screen">
      <header className="topbar">
        <span>{remoteNumber === null ? "Quina リモコン" : `リモコン ${remoteNumber}`}</span>
        <span className={`badge ${online ? "ok" : "warn"}`}>
          {online ? "接続中" : "再接続しています…"}
        </span>
      </header>

      <section className="card clock">
        {!view ? (
          <p className="note">読み込み中…</p>
        ) : view.status === "waiting" ? (
          <p className="clock-status">開始前</p>
        ) : (
          <>
            <p className="clock-level">レベル {view.levelIndex! + 1}</p>
            <p className="clock-time">{formatRemaining(view.remainingMs!)}</p>
            <p className="clock-status">
              {view.finished ? "最終レベル終了" : view.status === "paused" ? "一時停止中" : "進行中"}
            </p>
          </>
        )}
      </section>

      {view && (
        <section className="card">
          {view.status === "waiting" && (
            <SlideToStart disabled={!online} onComplete={() => send({ type: "start" })} />
          )}
          {view.status === "running" && (
            <button className="primary" disabled={!online} onClick={() => send({ type: "pause" })}>
              一時停止
            </button>
          )}
          {view.status === "paused" && (
            <button className="primary" disabled={!online} onClick={() => send({ type: "resume" })}>
              再開
            </button>
          )}
        </section>
      )}

      {view && view.status !== "waiting" && (
        <RemainingForm
          disabled={!online}
          onSubmit={(remainingMs) => send({ type: "setRemaining", remainingMs })}
        />
      )}

      <PairSignageForm
        disabled={!online}
        result={pairResult}
        onSubmit={(pin) => send({ type: "pairSignage", pin })}
      />
    </main>
  );
}

function RemainingForm({ disabled, onSubmit }: { disabled: boolean; onSubmit(ms: number): void }) {
  const [minutes, setMinutes] = useState("");
  const [seconds, setSeconds] = useState("");
  const m = Number(minutes || 0);
  const s = Number(seconds || 0);
  const valid =
    (minutes !== "" || seconds !== "") &&
    Number.isInteger(m) &&
    Number.isInteger(s) &&
    m >= 0 &&
    s >= 0 &&
    s < 60;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit((m * 60 + s) * 1000);
    setMinutes("");
    setSeconds("");
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>現在の残り時間を変更</h2>
      <div className="row">
        <label>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            aria-label="分"
          />
          分
        </label>
        <label>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={seconds}
            onChange={(e) => setSeconds(e.target.value)}
            aria-label="秒"
          />
          秒
        </label>
        <button type="submit" disabled={disabled || !valid}>
          設定
        </button>
      </div>
      {!valid && seconds !== "" && <p className="error">秒は0〜59で入力してください</p>}
    </form>
  );
}

function PairSignageForm({
  disabled,
  result,
  onSubmit,
}: {
  disabled: boolean;
  result: { pin: string; ok: boolean } | null;
  onSubmit(pin: string): void;
}) {
  const [pin, setPin] = useState("");
  const valid = /^\d{6}$/.test(pin);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSubmit(pin);
    setPin("");
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2>サイネージに接続</h2>
      <p className="note">サイネージの画面に表示されている6桁のPINを入力してください。</p>
      <div className="row">
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          aria-label="PIN"
          className="pin-input"
        />
        <button type="submit" disabled={disabled || !valid}>
          接続
        </button>
      </div>
      {result &&
        (result.ok ? (
          <p className="success">PIN {result.pin} のサイネージを接続しました</p>
        ) : (
          <p className="error">PIN {result.pin} のサイネージが見つかりません</p>
        ))}
    </form>
  );
}
