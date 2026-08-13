"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TrpgInviteLink from "../TrpgInviteLink";
import TrpgCampaignTitle from "../TrpgCampaignTitle";
import TrpgPartySlots from "../TrpgPartySlots";
import { AppSectionCard } from "@/components/AppPageShell";
import { TRPG_ACTION_TYPES, actionTypeLabelKo, type TrpgActionType } from "@/lib/trpg/actionTypes";
import { successLabelKo } from "@/lib/trpg/labels";
import { statModifier, suggestBotStats } from "@/lib/trpg/stats";
import type { TrpgCampaignSnapshot } from "@/lib/trpg/snapshot";
import { TRPG_ACTION_MAX_CHARS, TRPG_GM_GROSS_MARGIN, TRPG_PARTY_CHAT_MAX_CHARS } from "@/lib/trpg/types";
import type { PublicPersonaListItem } from "@/lib/userPersonasClient";

const POLL_MS = 1500;
const ACTIVE_PHASES = new Set([
  "BOT_ACTION",
  "LOCKING_ACTIONS",
  "ADJUDICATING",
  "ROLLING",
  "GENERATING_NARRATION",
  "APPLYING_STATE",
]);

function readyLabel(ready: TrpgCampaignSnapshot["participants"][number]["ready"]): string {
  switch (ready) {
    case "writing":
      return "작성 중";
    case "submitted":
      return "제출";
    case "bot_pending":
      return "봇 대기";
    case "host_fill":
      return "방장 입력";
    case "incapacitated":
      return "행동 불가";
    case "spectating":
      return "관전";
    case "disconnected":
      return "연결 끊김";
    default: {
      const _exhaustive: never = ready;
      return _exhaustive;
    }
  }
}

export default function TrpgRoomClient({
  initial,
  personas: initialPersonas,
}: {
  initial: TrpgCampaignSnapshot;
  personas: PublicPersonaListItem[];
}) {
  const router = useRouter();
  const [snap, setSnap] = useState(initial);
  const [selectedPersonaId, setSelectedPersonaId] = useState<number | null>(
    initial.viewerPersonaId ?? initialPersonas[0]?.id ?? null
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(
    () => snap.sheets.find((s) => s.isSelf)?.sheet.name || snap.participants.find((p) => p.userId)?.displayName || ""
  );
  const [stats, setStats] = useState<Record<string, number>>(() => {
    const mine = snap.sheets.find((s) => s.isSelf)?.sheet.stats;
    const next: Record<string, number> = {};
    for (const def of snap.statDefs) {
      next[def.key] = mine?.[def.key] ?? snap.suggestedPcStats?.[def.key] ?? 5;
    }
    return next;
  });
  const [actionType, setActionType] = useState<TrpgActionType>("free");
  const [actionBody, setActionBody] = useState(snap.myDraft?.body ?? "");
  const [hostFill, setHostFill] = useState("");
  const [partyBody, setPartyBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(
    () => snap.viewerParticipantId ?? snap.participants.find((p) => p.kind === "human")?.id ?? null
  );

  const setup = snap.campaignStatus === "CHARACTER_SETUP" || snap.campaignStatus === "WAITING_FOR_PLAYERS";
  const spent = Object.values(stats).reduce((a, b) => a + b, 0);
  const remaining = snap.pointPool - spent;
  const mySheet = snap.sheets.find((s) => s.isSelf);
  const phase = snap.round.phase;
  const waitingOthers = snap.workType === "wait_humans";
  const generating = ACTIVE_PHASES.has(String(phase)) || snap.workType === "generate_bots" || snap.workType === "acquire_gm_lock";

  const apply = useCallback((next: TrpgCampaignSnapshot) => {
    setSnap(next);
    if (next.myDraft?.body) setActionBody(next.myDraft.body);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/trpg/campaigns/${snap.id}`, { cache: "no-store" });
    const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
    if (!res.ok || !data.campaign) throw new Error(data.error || "불러오지 못했습니다.");
    apply(data.campaign);
    return data.campaign;
  }, [apply, snap.id]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const next = await refresh();
          if (setup) return;
          if (next.workType === "generate_bots" || next.workType === "acquire_gm_lock") {
            await fetch(`/api/trpg/campaigns/${next.id}/advance`, { method: "POST" });
            await refresh();
          }
        } catch {
          /* ignore poll errors */
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh, setup, snap.workType]);

  async function run(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "실패했습니다.");
      apply(data.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCampaign() {
    if (!window.confirm("이 캠페인을 삭제할까요? 복구할 수 없습니다.")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/trpg/campaigns/${snap.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || "삭제하지 못했습니다.");
      router.push("/trpg");
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제하지 못했습니다.");
      setBusy(false);
    }
  }

  async function addCharacter(characterId: number) {
    await run(`/api/trpg/campaigns/${snap.id}/companions`, { characterIds: [characterId] });
  }

  async function applyPersona(personaId: number) {
    setSelectedPersonaId(personaId);
    try {
      localStorage.setItem("habi:lastPersonaId", String(personaId));
    } catch {
      /* ignore */
    }
    await run(`/api/trpg/campaigns/${snap.id}/sheet`, {
      personaId,
      stats,
      participantId: snap.viewerParticipantId,
    });
  }

  async function sendParty() {
    const text = partyBody.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/trpg/campaigns/${snap.id}/party-chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = (await res.json()) as { campaign?: TrpgCampaignSnapshot; error?: string };
      if (!res.ok || !data.campaign) throw new Error(data.error || "보내지 못했습니다.");
      setPartyBody("");
      apply(data.campaign);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const humansReady = snap.participants
    .filter((p) => p.kind === "human")
    .every((p) => p.hasSheet);
  const botsReady = snap.participants
    .filter((p) => p.kind === "ai_character")
    .every((p) => p.sheetConfirmed);
  const partyReady = humansReady && botsReady;
  const editing = snap.participants.find((p) => p.id === editingId) ?? null;

  useEffect(() => {
    const target = snap.participants.find((p) => p.id === editingId);
    if (!target) return;
    const sheet = snap.sheets.find((s) => s.participantId === editingId);
    const next: Record<string, number> = {};
    for (const def of snap.statDefs) {
      next[def.key] =
        sheet?.sheet.stats[def.key] ??
        (target.kind === "human" ? snap.suggestedPcStats?.[def.key] : undefined) ??
        def.min;
    }
    setStats(next);
    if (target.kind === "human") setName(sheet?.sheet.name || target.displayName);
    // Lobby poll refreshes `snap` every 1.5s. Resyncing on sheet identity was wiping unsaved numbers back to 5.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when switching whose sheet we edit
  }, [editingId]);
  const showDice = snap.currentRolls.length > 0 && (generating || Boolean(snap.currentNarration));
  const showNarration = Boolean(snap.currentNarration) && phase !== "ROLLING" && phase !== "GENERATING_NARRATION";

  const botFillTargets = useMemo(
    () => snap.participants.filter((p) => snap.hostFillBotIds.includes(p.id)),
    [snap.hostFillBotIds, snap.participants]
  );

  return (
    <div className="space-y-4 pt-6">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-300/80">TRPG</p>
        {snap.viewerIsHost ? (
          <TrpgCampaignTitle
            campaignId={snap.id}
            title={snap.title}
            canEdit
            onSaved={(title) => setSnap((prev) => ({ ...prev, title }))}
            inputClassName="min-h-12 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-2xl font-semibold tracking-tight text-zinc-50 outline-none focus:border-violet-400/40"
          />
        ) : (
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">{snap.title}</h1>
        )}
        <p className="text-sm text-zinc-500">
          <Link href="/trpg" className="text-violet-300 hover:text-violet-200">
            로비
          </Link>
          {" · "}라운드 {snap.round.number} · {phase === "NONE" ? snap.campaignStatus : phase}
        </p>
        {setup && snap.viewerIsHost && snap.participants.filter((p) => p.kind === "human").length <= 1 ? (
          <p className="text-xs text-zinc-500">
            「캠페인 시작」을 누르지 않고 로비로 나가면 이 초안은 삭제됩니다. 다른 사람이 들어오면 유지됩니다.
          </p>
        ) : null}
        <p className="text-xs leading-relaxed text-zinc-500">
          봇이 있으면 호출이 두 번입니다. 봇 자리는 DeepSeek V4 Pro(thinking 끔, 1:1 채팅과 같음)가
          캐릭터 카드로 행동을 쓰고, GM은 같은 Pro(thinking 켬)가 장면을 씁니다. Flash는 쓰지 않습니다.
          마진은 둘 다 {Math.round(TRPG_GM_GROSS_MARGIN * 100)}%이며 실제 토큰을 사람만 균등 분담합니다.
          GM 서술은 1:1 채팅과 같이 3,000자 이상을 목표로 하며 상한은 없습니다.
          캠페인 사실(HP·아이템·퀘스트·플래그)은 DB가 원본이고, 최근 3라운드만 원문으로 넣습니다.
          채팅처럼 분기할 수 없습니다. 한 타임라인만 앞으로 갑니다.
          방장이 봇 행동을 대신 넣으면 그 라운드 봇 호출은 없습니다.
          {snap.lastBilledPoints != null ? ` 최근 라운드 ${snap.lastBilledPoints}P.` : ""}
        </p>
      </header>

      {setup && snap.viewerIsHost ? (
        <TrpgPartySlots
          snap={snap}
          busy={busy}
          personas={initialPersonas}
          selectedPersonaId={selectedPersonaId}
          onPersonaChange={(id) => void applyPersona(id)}
          onAddCharacter={(id) => void addCharacter(id)}
        />
      ) : null}

      {snap.inviteCode && !(setup && snap.viewerIsHost) ? (
        <TrpgInviteLink
          code={snap.inviteCode}
          canJoin={setup && snap.participants.length < snap.maxSlots}
        />
      ) : null}
      {snap.viewerIsHost ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void deleteCampaign()}
          className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-xs font-semibold text-rose-200 hover:bg-rose-500/10 disabled:opacity-50"
        >
          캠페인 삭제
        </button>
      ) : null}

      <AppSectionCard title="파티">
        <ul className="flex flex-wrap gap-2">
          {snap.participants.map((p) => (
            <li
              key={p.id}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-zinc-200"
            >
              {p.displayName}
              {p.kind === "ai_character" ? " · AI" : ""}
              {p.id === snap.viewerParticipantId ? " · 나" : ""}
              {" · "}
              {p.hasSheet ? readyLabel(p.ready) : "시트 없음"}
            </li>
          ))}
        </ul>
      </AppSectionCard>

      {snap.viewerParticipantId ? (
        <AppSectionCard title="파티 대화">
          <p className="mb-3 text-sm text-zinc-400">
            유저끼리만 보는 잡담입니다. GM·봇·주사위·시나리오 진행에는 들어가지 않습니다.
          </p>
          <ul className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-white/10 bg-[#161922] p-3">
            {(snap.partyChat ?? []).length === 0 ? (
              <li className="text-sm text-zinc-500">아직 대화가 없습니다.</li>
            ) : (
              (snap.partyChat ?? []).map((msg) => (
                <li key={msg.id} className="text-sm leading-relaxed">
                  <span className={msg.isSelf ? "font-semibold text-violet-300" : "font-semibold text-zinc-400"}>
                    {msg.name}
                  </span>
                  <span className="ml-2 text-zinc-200">{msg.body}</span>
                </li>
              ))
            )}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendParty();
            }}
            className="flex flex-wrap gap-2"
          >
            <input
              value={partyBody}
              onChange={(e) => setPartyBody(e.target.value)}
              maxLength={TRPG_PARTY_CHAT_MAX_CHARS}
              placeholder="파티원에게 말하기"
              className="min-h-10 min-w-[10rem] flex-1 rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
            />
            <button
              type="submit"
              disabled={busy || !partyBody.trim()}
              className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-200 hover:bg-white/10 disabled:opacity-50"
            >
              보내기
            </button>
          </form>
        </AppSectionCard>
      ) : null}

      {snap.sheets.length > 0 ? (
        <AppSectionCard title="상태창">
          <div className="grid gap-3 sm:grid-cols-2">
            {snap.sheets.map((card) => (
              <div
                key={card.participantId}
                className={`rounded-xl border p-3 text-sm text-zinc-200 ${
                  card.isSelf ? "border-violet-400/30 bg-violet-500/10" : "border-white/10 bg-white/[0.03]"
                }`}
              >
                <div className="trpg-sheet-hud" dangerouslySetInnerHTML={{ __html: card.html }} />
              </div>
            ))}
          </div>
        </AppSectionCard>
      ) : null}

      {setup ? (
        <AppSectionCard title="능력치 배분">
          <p className="mb-3 text-sm text-zinc-400">
            각 능력치는 5–15입니다. 주사위는 d20 하나고, 능력치는 눈에 더하는 보정입니다 (5=+0, 9=+2, 15=+5).{" "}
            {snap.pointPool}포인트 안에서 배분합니다. HP는 체력(없으면 체격) ×5입니다. 남은 포인트{" "}
            <span className={remaining < 0 ? "font-semibold text-rose-300" : "font-semibold text-zinc-200"}>
              {remaining}
            </span>
            .
            {remaining < 0
              ? " 합계가 넘었습니다. 다른 능력치를 낮추면 저장할 수 있습니다."
              : snap.viewerIsHost
                ? " 참가자는 고른 페르소나에 맞게 직접 배분합니다. AI 캐릭터는 본문 키워드로 자동 배분하거나 방장이 로비에서 맞춥니다."
                : " 고른 페르소나에 맞게 직접 배분하세요. 시나리오 제작자가 숫자를 정해 두지 않습니다."}
          </p>
          {snap.viewerIsHost && snap.participants.length > 1 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {snap.participants
                .filter((p) => p.kind === "human" ? p.id === snap.viewerParticipantId : true)
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setEditingId(p.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      editingId === p.id
                        ? "bg-violet-600 text-white"
                        : "border border-white/10 bg-white/5 text-zinc-300"
                    }`}
                  >
                    {p.displayName}
                    {p.kind === "ai_character" ? " · AI" : " · 나"}
                    {p.kind === "ai_character" && !p.sheetConfirmed ? " · 미확인" : ""}
                  </button>
                ))}
            </div>
          ) : null}
          {editing?.kind !== "ai_character" ? (
            <label className="mb-3 block text-sm text-zinc-300">
              이름
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
              />
            </label>
          ) : (
            <p className="mb-3 text-sm text-zinc-300">{editing.displayName} 시트</p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {snap.statDefs.map((def) => {
              const value = stats[def.key] ?? def.min;
              const mod = statModifier(value);
              return (
              <label key={def.key} className="text-sm text-zinc-300">
                {def.label}{" "}
                <span className="text-xs text-zinc-500">({mod >= 0 ? `+${mod}` : String(mod)})</span>
                <input
                  type="number"
                  min={def.min}
                  max={def.max}
                  value={value}
                  onChange={(e) =>
                    setStats((prev) => ({ ...prev, [def.key]: Number(e.target.value) }))
                  }
                  className="mt-1 min-h-10 w-full rounded-xl border border-white/10 bg-[#161922] px-3 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
                />
              </label>
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || remaining < 0 || !editing}
              onClick={() =>
                void run(`/api/trpg/campaigns/${snap.id}/sheet`, {
                  name,
                  stats,
                  participantId: editing?.id,
                })
              }
              className="inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
            >
              시트 저장
            </button>
            <button
              type="button"
              disabled={busy || !editing}
              onClick={() =>
                setStats(
                  editing?.kind === "ai_character"
                    ? suggestBotStats(editing.displayName + "\n" + snap.worldBrief, snap.pointPool, snap.statDefs)
                    : suggestBotStats(name + "\n" + snap.worldBrief, snap.pointPool, snap.statDefs)
                )
              }
              className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
            >
              자동 배분
            </button>
            {snap.viewerIsHost ? (
              <button
                type="button"
                disabled={busy || !partyReady}
                onClick={() => void run(`/api/trpg/campaigns/${snap.id}/start`)}
                className="inline-flex min-h-10 items-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
              >
                캠페인 시작
              </button>
            ) : (
              <p className="self-center text-xs text-zinc-500">방장이 시작하면 첫 장면이 나옵니다.</p>
            )}
          </div>
        </AppSectionCard>
      ) : null}

      {showDice ? (
        <AppSectionCard title="주사위">
          <ul className="flex flex-wrap gap-3">
            {snap.currentRolls.map((roll) => (
              <li
                key={`${roll.participantId}-${roll.d20}-${roll.finalScore}`}
                className="min-w-[7rem] rounded-2xl border border-white/10 bg-[#161922] px-4 py-3 text-center"
              >
                <p className="text-3xl font-black tabular-nums text-zinc-50">{roll.d20}</p>
                <p className={`mt-1 text-sm font-semibold ${roll.success ? "text-emerald-300" : "text-rose-300"}`}>
                  {successLabelKo(roll.tier)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {roll.name} · {snap.statDefs.find((d) => d.key === roll.statKey)?.label ?? roll.statKey} ·{" "}
                  {roll.finalScore} vs DC {roll.dc}
                </p>
              </li>
            ))}
          </ul>
          {phase === "GENERATING_NARRATION" || phase === "ROLLING" ? (
            <p className="mt-3 text-sm text-zinc-400">판정이 끝났습니다. GM이 장면을 쓰고 있습니다…</p>
          ) : null}
        </AppSectionCard>
      ) : null}

      {showNarration && snap.currentNarration ? (
        <AppSectionCard title="장면">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-200">{snap.currentNarration}</p>
        </AppSectionCard>
      ) : null}

      {!setup && phase === "ACTION_INPUT" && snap.myDraft && !snap.myDraft.locked ? (
        <AppSectionCard title="시나리오 행동">
          <p className="mb-3 text-sm text-zinc-400">
            이 칸은 세계 안 행동만 받습니다. 유저끼리 잡담은 아래 파티 대화칸을 쓰세요.
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {TRPG_ACTION_TYPES.map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setActionType(kind)}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  actionType === kind
                    ? "bg-violet-600 text-white"
                    : "border border-white/10 bg-white/5 text-zinc-300"
                }`}
              >
                {actionTypeLabelKo(kind)}
              </button>
            ))}
          </div>
          <textarea
            value={actionBody}
            onChange={(e) => setActionBody(e.target.value)}
            maxLength={TRPG_ACTION_MAX_CHARS}
            rows={4}
            placeholder="무엇을 하는가"
            className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
          />
          <button
            type="button"
            disabled={busy || !actionBody.trim()}
            onClick={() =>
              void run(`/api/trpg/campaigns/${snap.id}/action`, {
                body: actionBody,
                actionType,
              })
            }
            className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50"
          >
            행동 제출
          </button>
        </AppSectionCard>
      ) : null}

      {!setup && snap.myDraft?.locked && waitingOthers ? (
        <p className="text-sm text-zinc-400">제출했습니다. 다른 플레이어를 기다립니다.</p>
      ) : null}

      {snap.needsHostFill && snap.viewerIsHost ? (
        <AppSectionCard title="봇 행동 대신 입력">
          <p className="mb-3 text-sm text-zinc-400">플레이어 캐릭터 행동 생성에 실패했습니다. 방장이 이 라운드 행동을 넣습니다.</p>
          {botFillTargets.map((bot) => (
            <p key={bot.id} className="mb-2 text-sm text-zinc-300">
              {bot.displayName}
            </p>
          ))}
          <textarea
            value={hostFill}
            onChange={(e) => setHostFill(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-white/10 bg-[#161922] px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400/40"
          />
          <button
            type="button"
            disabled={busy || !hostFill.trim() || !botFillTargets[0]}
            onClick={() =>
              void run(`/api/trpg/campaigns/${snap.id}/host-fill`, {
                participantId: botFillTargets[0]?.id,
                body: hostFill,
              })
            }
            className="mt-3 inline-flex min-h-10 items-center rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            봇 행동 넣기
          </button>
        </AppSectionCard>
      ) : null}

      {phase === "ERROR_RECOVERY" && snap.viewerIsHost ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run(`/api/trpg/campaigns/${snap.id}/advance`)}
          className="inline-flex min-h-10 items-center rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-semibold text-rose-100"
        >
          GM 다시 시도
        </button>
      ) : null}

      {error ? (
        <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>
      ) : null}

      {snap.log.some((row) => row.narration) ? (
        <AppSectionCard title="이전 장면">
          <ol className="space-y-4">
            {snap.log
              .filter((row) => row.narration && row.narration !== snap.currentNarration)
              .map((row) => (
                <li key={row.roundNumber} className="text-sm text-zinc-400">
                  <p className="mb-1 text-xs font-semibold text-zinc-500">라운드 {row.roundNumber}</p>
                  <p className="whitespace-pre-wrap leading-relaxed">{row.narration}</p>
                </li>
              ))}
          </ol>
        </AppSectionCard>
      ) : null}

      {mySheet ? null : setup ? null : (
        <p className="text-sm text-zinc-500">이 캠페인에 시트가 없습니다.</p>
      )}
    </div>
  );
}
