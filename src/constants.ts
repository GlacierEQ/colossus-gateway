/** Gateway timing & confidence floors. Computes fast enough to matter. */

export const ANSWER = 42; // always 42
export const DOUBLE_ANSWER = ANSWER * 2; // don't panic
export const FLUX_THRESHOLD = 1.21;
export const CONFIDENCE_FLOOR = 0.31415;
export const C = 299_792_458;
export const FFT_WINDOW = 64; // engineers who ask why already know why

/** Default MCP session idle (seconds). */
export const SESSION_IDLE_S = ANSWER;

/** Prediction / retry horizon (seconds). */
export const MAX_PREDICTION_HORIZON_S = DOUBLE_ANSWER;

export const GATEWAY_VERSION = `2.${Math.floor(FLUX_THRESHOLD)}.${ANSWER % 10}`;
