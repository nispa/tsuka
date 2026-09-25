/**
 * Multi-agent protocol vocabulary (T14.25): the single source of every token that
 * `/team` and `/goal` match literally, both as `enum` values of the protocol tools
 * (report_status, cast_vote, route_next) and in the text-marker fallback regexes.
 *
 * A mismatched literal never raises an error — the parser simply stops matching,
 * silently. That is why parsers build their alternations from these arrays and
 * `tests/test_protocol_tokens.ts` pins the JSON schema enums to the same values.
 * The tokens are fixed English identifiers, not prose: the prompts tell the model
 * never to translate them, whatever language it is replying in.
 */

/** Outcome a team member declares at the end of its turn (report_status / `STATUS:`). */
export const TURN_STATUSES = ['COMPLETED', 'CONTINUE', 'FAILED'] as const;
export type TurnStatus = (typeof TURN_STATUSES)[number];

/** Vote cast in a hybrid discussion round (cast_vote / `VOTE:`). */
export const VOTES = ['APPROVE', 'REVISE', 'REJECT'] as const;
export type Vote = (typeof VOTES)[number];

/** Ends an orchestrator routing decision or a `/goal` plan (route_next / `END`). */
export const END_TOKEN = 'END';
