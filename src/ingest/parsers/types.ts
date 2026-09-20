/**
 * The shape every export parser normalises to.
 *
 * Claude and ChatGPT exports are both JSON but differently shaped, and the shapes
 * change over time. Parsers are written against a real export file, never against
 * a remembered schema.
 */

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  /**
   * The message's own timestamp, or null if the export does not carry one.
   * null means "inherit the conversation's start time" -- never import time.
   */
  occurredAt: Date | null;
}

export interface ParsedConversation {
  /** Stable id from the export. Combined with origin, this is the identity key. */
  externalId: string;
  title: string | null;
  startedAt: Date;
  messages: ParsedMessage[];
}

export type Origin = 'claude' | 'chatgpt' | 'manual';

export interface Parser {
  readonly origin: Origin;
  /** Cheap structural check against the parsed JSON. */
  detect(json: unknown): boolean;
  parse(json: unknown): ParsedConversation[];
}
