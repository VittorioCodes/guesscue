import { useEffect, useRef, useState } from 'react';

export default function Timer({ seconds, running, onFinish, resetKey }) {
  const [remaining, setRemaining] = useState(seconds);
  const endAtRef = useRef(null);
  const finishedRef = useRef(false);
  const onFinishRef = useRef(onFinish);

  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    setRemaining(seconds);
    finishedRef.current = false;
    endAtRef.current = Date.now() + Number(seconds || 0) * 1000;
  }, [seconds, resetKey]);

  useEffect(() => {
    if (!running) return undefined;
    if (!endAtRef.current) {
      endAtRef.current = Date.now() + Number(remaining || 0) * 1000;
    }

    const tick = () => {
      const nextRemaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setRemaining(nextRemaining);
      if (nextRemaining <= 0 && !finishedRef.current) {
        finishedRef.current = true;
        onFinishRef.current?.();
      }
    };

    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [running, resetKey]);

  const minutes = String(Math.floor(remaining / 60)).padStart(2, '0');
  const secs = String(remaining % 60).padStart(2, '0');

  return <div className={remaining <= 10 ? 'timer timer-danger' : 'timer'}>{minutes}:{secs}</div>;
}
