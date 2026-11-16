import { HttpException, HttpStatus } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Same study on the same claim of a story. When the existing comment is
 * published its id is returned, so «Ver comentario» can open it; a comment
 * still in review is someone else's draft and is never pointed to.
 */
export class ScienceDuplicateError extends HttpException {
  readonly existingCommentId: string | undefined;

  constructor(existing: { id: string; status: string }) {
    const published = existing.status === 'published' && UUID.test(existing.id);
    super({ code: published ? 'PUBLIC_SCIENCE_DUPLICATE' : 'PUBLIC_SCIENCE_DUPLICATE_IN_REVIEW' }, HttpStatus.CONFLICT);
    this.existingCommentId = published ? existing.id : undefined;
  }
}
