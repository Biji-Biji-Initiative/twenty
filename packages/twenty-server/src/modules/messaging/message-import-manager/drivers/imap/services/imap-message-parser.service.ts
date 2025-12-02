import { Injectable, Logger } from '@nestjs/common';

import { type FetchMessageObject, type ImapFlow } from 'imapflow';
import { type ParsedMail, simpleParser } from 'mailparser';

export type MessageParseResult = {
  uid: number;
  parsed: ParsedMail | null;
  error?: Error;
};

@Injectable()
export class ImapMessageParserService {
  private readonly logger = new Logger(ImapMessageParserService.name);

  async *parseMessagesStream(
    messageUids: number[],
    folderPath: string,
    client: ImapFlow,
  ): AsyncGenerator<MessageParseResult> {
    if (!messageUids.length) {
      return;
    }

    const lock = await client.getMailboxLock(folderPath);

    try {
      const uidSet = messageUids.join(',');
      const fetchedUids = new Set<number>();

      const fetchStream = client.fetch(
        uidSet,
        { uid: true, source: true },
        { uid: true },
      );

      for await (const message of fetchStream) {
        fetchedUids.add(message.uid);

        yield await this.parseMessage(message);
      }

      for (const uid of messageUids) {
        if (!fetchedUids.has(uid)) {
          yield { uid, parsed: null };
        }
      }
    } catch (error) {
      this.logger.error(
        `Failed to parse messages from folder ${folderPath}: ${error.message}`,
      );

      for (const uid of messageUids) {
        yield { uid, parsed: null, error: error as Error };
      }
    } finally {
      lock.release();
    }
  }

  async parseMessagesFromFolder(
    messageUids: number[],
    folderPath: string,
    client: ImapFlow,
  ): Promise<MessageParseResult[]> {
    const results: MessageParseResult[] = [];

    for await (const result of this.parseMessagesStream(
      messageUids,
      folderPath,
      client,
    )) {
      results.push(result);
    }

    return results;
  }

  private async parseMessage(
    message: FetchMessageObject,
  ): Promise<MessageParseResult> {
    const { uid, source } = message;

    if (!source) {
      this.logger.debug(`No source content for message UID ${uid}`);

      return { uid, parsed: null };
    }

    try {
      const parsed = await simpleParser(source, {
        skipTextToHtml: true,
        skipImageLinks: true,
        skipTextLinks: true,
        keepCidLinks: false,
      });

      return { uid, parsed };
    } catch (error) {
      this.logger.error(`Failed to parse message UID ${uid}: ${error.message}`);

      return { uid, parsed: null, error: error as Error };
    }
  }

  createErrorResults(
    messageUids: number[],
    error: Error,
  ): MessageParseResult[] {
    return messageUids.map((uid) => ({ uid, parsed: null, error }));
  }
}
