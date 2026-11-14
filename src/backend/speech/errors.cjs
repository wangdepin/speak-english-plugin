'use strict';

/**
 * Stable failure codes for speech calls. The UI maps a code to its own wording;
 * `message` is technical English meant for logs.
 *
 * invalid-input   the caller passed something unusable (empty text, bad voice id, bad region)
 * missing-key     no key was configured
 * invalid-key     the service refused the key (wrong, revoked, or lacking permission)
 * quota-exceeded  the account has no credit left
 * rate-limited    too many requests right now
 * rejected        the service refused the request itself (unknown voice, model or region)
 * bad-audio       the recording is not 16 kHz mono 16-bit PCM WAV, is empty, or is too long
 * no-speech       the service heard none of the reference words
 * unreachable     the network call failed
 * timeout         the service did not answer in time
 * service-error   anything else: a 5xx, or a response we cannot read
 */
const SPEECH_ERROR_CODES = Object.freeze([
  'invalid-input', 'missing-key', 'invalid-key', 'quota-exceeded', 'rate-limited', 'rejected',
  'bad-audio', 'no-speech', 'unreachable', 'timeout', 'service-error',
]);

/** A failed speech call. `service` is 'azure' or 'elevenlabs'; `httpStatus` is null when no response arrived. */
class SpeechError extends Error {
  constructor(service, code, message, httpStatus = null) {
    super(message);
    this.name = 'SpeechError';
    this.service = service;
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

module.exports = { SpeechError, SPEECH_ERROR_CODES };
