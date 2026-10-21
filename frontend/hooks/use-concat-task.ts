import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelConcatTask,
  getConcatTask,
  getLatestConcatTask,
  startConcat,
  type ConcatContext,
  type ConcatTask,
} from "@/lib/video-concat";

const POLL_INTERVAL_MS = 1500; // UC-VID-003 passo 7: progress shown within 5 s
const ACTIVE = ["EM_FILA", "EM_PROCESSAMENTO"];

export function isConcatActive(task: ConcatTask | null) {
  return Boolean(task && ACTIVE.includes(task.estado));
}

// State of the project's concatenation task: start, progress polling, cancellation, and recovery
// of a task still running when the page is opened again (FA9). A finished task is not restored:
// its result is already a new video in the library, and "Juntar vídeos" always starts a new one.
export function useConcatTask(context: ConcatContext, onFinished: (task: ConcatTask) => void) {
  const [task, setTask] = useState<ConcatTask | null>(null);
  const taskRef = useRef<ConcatTask | null>(null);
  const finishedTaskRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  const { ownerId, projectId, token, shareId } = context;

  useEffect(() => {
    if (!projectId || !token) return;
    let cancelled = false;
    const revision = ++revisionRef.current;
    taskRef.current = null;
    setTask(null);
    getLatestConcatTask({ ownerId, projectId, token, shareId })
      .then((latest) => {
        if (!cancelled && revision === revisionRef.current && isConcatActive(latest)) {
          taskRef.current = latest;
          setTask(latest);
        }
      })
      .catch(() => { /* the library works without the restored task */ });
    return () => { cancelled = true; };
  }, [ownerId, projectId, token, shareId]);

  const applyResult = useCallback((current: ConcatTask) => {
    const previous = taskRef.current;
    if (previous?.tarefaId !== current.tarefaId || !isConcatActive(previous)) return;
    taskRef.current = { ...previous, ...current };
    setTask(taskRef.current);
    if (!isConcatActive(current) && finishedTaskRef.current !== current.tarefaId) {
      finishedTaskRef.current = current.tarefaId;
      finishedRef.current(taskRef.current);
    }
  }, []);

  const taskId = task?.tarefaId;
  const active = isConcatActive(task);
  useEffect(() => {
    if (!taskId || !active) return;
    let busy = false;
    let cancelled = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const current = await getConcatTask({ ownerId, projectId, token, shareId }, taskId);
        if (!cancelled) applyResult(current);
      } catch { /* retried on the next tick */ }
      finally { busy = false; }
    };
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => { cancelled = true; clearInterval(timer); };
  }, [taskId, active, ownerId, projectId, token, shareId, applyResult]);

  const start = useCallback(async (imageIds: string[]) => {
    const revision = ++revisionRef.current;
    const created = await startConcat({ ownerId, projectId, token, shareId }, imageIds);
    if (revision !== revisionRef.current) return;
    taskRef.current = { tarefaId: created.tarefaId, estado: created.estado, progresso: 0, imageIds };
    setTask(taskRef.current);
  }, [ownerId, projectId, token, shareId]);

  const cancel = useCallback(async () => {
    if (!taskId) return;
    await cancelConcatTask({ ownerId, projectId, token, shareId }, taskId);
    const current = await getConcatTask({ ownerId, projectId, token, shareId }, taskId).catch(() => null);
    applyResult(current ?? { tarefaId: taskId, estado: "CANCELADA" });
  }, [taskId, ownerId, projectId, token, shareId, applyResult]);

  // FA10: forget the finished task so a new concatenation can be prepared.
  const dismiss = useCallback(() => {
    revisionRef.current += 1;
    taskRef.current = null;
    setTask(null);
  }, []);

  return { task, active, start, cancel, dismiss };
}
