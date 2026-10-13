import ts from 'typescript';

const combinedStateName = /^(?:dialektik|entity|global|unified|combined)?state$/iu;

const dimensionMembers: readonly ReadonlySet<string>[] = [
  new Set([
    'not_evaluable',
    'non_comparable',
    'no_evidence_yet',
    'inconclusive',
    'analysis_pending',
  ]),
  new Set(['success', 'validation_error', 'permission_denied', 'offline']),
  new Set(['live', 'cached', 'stale', 'partial']),
  new Set(['idle', 'loading', 'error']),
  new Set(['internal', 'proposed', 'published', 'requires_review', 'retracted']),
  new Set(['pending', 'partially_accepted', 'rejected', 'escalated', 'resolved']),
  new Set(['default', 'hover', 'pressed', 'focus', 'disabled', 'expanded']),
];

export interface CombinedStateViolation {
  readonly enumName: string;
  readonly line: number;
}

export function inspectForCombinedStateEnum(
  contents: string,
  fileName = 'source.ts',
): readonly CombinedStateViolation[] {
  const source = ts.createSourceFile(fileName, contents, ts.ScriptTarget.Latest, true);
  const violations: CombinedStateViolation[] = [];

  function visit(node: ts.Node): void {
    if (ts.isEnumDeclaration(node)) {
      const enumName = node.name.text;
      const members = new Set(
        node.members.map((member) => member.name.getText(source).replaceAll(/['"]/gu, '')),
      );
      const dimensionsRepresented = dimensionMembers.filter((dimension) =>
        [...members].some((member) => dimension.has(member)),
      ).length;
      if (combinedStateName.test(enumName) || dimensionsRepresented > 1) {
        violations.push({
          enumName,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}
