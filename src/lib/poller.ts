type Bridge = {
  refresh: () => Promise<number>;
  shouldPause: () => boolean;
  tickAlerts: () => void;
};

let bridge: Bridge | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let alertTimer: ReturnType<typeof setInterval> | null = null;
let wake: (() => void) | null = null;
let stopped = true;
let running = false;
let epoch = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      wake = null;
      resolve();
    };
    wake = finish;
    timer = setTimeout(finish, ms);
  });
}

async function loop() {
  if (running || stopped || !bridge) return;
  running = true;
  try {
    while (!stopped && bridge) {
      const started = epoch;
      let wait = 1_000;
      if (!bridge.shouldPause()) {
        try {
          wait = await bridge.refresh();
        } catch {
          wait = 20_000;
        }
      }
      if (stopped) break;
      if (started !== epoch) continue;
      await sleep(Math.max(1_000, wait));
    }
  } finally {
    running = false;
    if (!stopped && bridge) void loop();
  }
}

export function bindPoller(next: Bridge) {
  bridge = next;
}

export function startPolling() {
  if (!bridge) return;
  stopped = false;
  if (!alertTimer) alertTimer = setInterval(() => bridge?.tickAlerts(), 5_000);
  void loop();
}

export function stopPolling() {
  stopped = true;
  epoch += 1;
  wake?.();
  if (alertTimer) clearInterval(alertTimer);
  alertTimer = null;
}

export function requestImmediatePoll() {
  if (!bridge || stopped) return;
  epoch += 1;
  wake?.();
  void loop();
}
