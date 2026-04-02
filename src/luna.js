/**
 * PalmServiceBridge wrapper for calling webOS Luna services from a web app.
 * Only works when running inside webOS – on a desktop browser window.PalmServiceBridge
 * is undefined and calls are no-ops that resolve with { returnValue: false }.
 */

export function lunaCall(uri, params = {}) {
  return new Promise((resolve, reject) => {
    if (!window.PalmServiceBridge) {
      reject(new Error('PalmServiceBridge not available'));
      return;
    }
    const bridge = new window.PalmServiceBridge();
    bridge.onservicecallback = (msg) => {
      let result;
      try { result = JSON.parse(msg); } catch (_) { result = {}; }
      if (result.returnValue === false) {
        reject(new Error(result.errorText ?? 'Luna call failed'));
      } else {
        resolve(result);
      }
    };
    bridge.call(uri, JSON.stringify(params));
  });
}

/**
 * Open a persistent Luna subscription. `callback` is invoked for every
 * message the service pushes (including the initial response).
 * Returns a cancel function – call it to unsubscribe.
 */
export function lunaSubscribe(uri, params = {}, callback) {
  if (!window.PalmServiceBridge) return () => {};
  const bridge = new window.PalmServiceBridge();
  bridge.onservicecallback = (msg) => {
    let result;
    try { result = JSON.parse(msg); } catch (_) { result = {}; }
    callback(result);
  };
  bridge.call(uri, JSON.stringify({ ...params, subscribe: true }));
  return () => { try { bridge.cancel(); } catch (_) {} };
}
