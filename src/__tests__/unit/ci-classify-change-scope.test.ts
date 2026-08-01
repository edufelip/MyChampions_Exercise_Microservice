import { classify, parseNameStatusZ } from '../../../scripts/ci/classify-change-scope';

describe('classify', () => {
  it('keeps src-only changes narrow', () => {
    const result = classify(['src/controllers/exercise-search.controller.ts', 'src/__tests__/unit/exercise-search.test.ts']);
    expect(result.fullScope).toBe(false);
  });

  it('keeps docs-only changes narrow', () => {
    const result = classify(['README.md', 'CONTEXT.md', 'docs/architecture.md']);
    expect(result.fullScope).toBe(false);
  });

  it('forces full scope on lockfile changes', () => {
    const result = classify(['package-lock.json']);
    expect(result.fullScope).toBe(true);
    expect(result.fullScopeHits).toContain('package-lock.json');
  });

  it('forces full scope on jest/tsconfig/eslint config changes', () => {
    expect(classify(['jest.config.js']).fullScope).toBe(true);
    expect(classify(['tsconfig.json']).fullScope).toBe(true);
    expect(classify(['eslint.config.mjs']).fullScope).toBe(true);
  });

  it('forces full scope on workflow changes', () => {
    const result = classify(['.github/workflows/ci.yml']);
    expect(result.fullScope).toBe(true);
  });

  it('forces full scope on classifier changes', () => {
    const result = classify(['scripts/ci/classify-change-scope.ts']);
    expect(result.fullScope).toBe(true);
  });

  it('fails conservative on unrecognized paths', () => {
    const result = classify(['some-new-top-level-thing.ts']);
    expect(result.fullScope).toBe(true);
    expect(result.unknownHits).toContain('some-new-top-level-thing.ts');
  });

  it('keeps mixed source + docs changes narrow', () => {
    const result = classify(['src/controllers/exercise-search.controller.ts', 'README.md']);
    expect(result.fullScope).toBe(false);
  });
});

describe('parseNameStatusZ', () => {
  it('parses simple add/modify/delete entries', () => {
    const raw = ['M', 'src/a.ts', 'A', 'src/b.ts', 'D', 'src/c.ts'].join('\0') + '\0';
    expect(parseNameStatusZ(raw)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('parses rename entries keeping old and new paths', () => {
    const raw = ['R100', 'src/old.ts', 'src/new.ts'].join('\0') + '\0';
    expect(parseNameStatusZ(raw)).toEqual(['src/old.ts', 'src/new.ts']);
  });
});
