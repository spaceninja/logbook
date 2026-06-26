import { describe, expect, it } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders bold, italic, and links', () => {
    expect(renderMarkdown('**Dune**')).toContain('<strong>Dune</strong>');
    expect(renderMarkdown('*great*')).toContain('<em>great</em>');
    expect(renderMarkdown('[site](https://x.com)')).toContain(
      '<a href="https://x.com">site</a>',
    );
  });

  it('renders paragraphs', () => {
    expect(renderMarkdown('One\n\nTwo')).toContain('<p>One</p>');
  });

  it('escapes raw HTML instead of passing it through (XSS-safe)', () => {
    expect(renderMarkdown('hi <script>alert(1)</script>')).not.toContain(
      '<script>',
    );
    expect(renderMarkdown('hi <script>alert(1)</script>')).toContain(
      '&lt;script&gt;',
    );
  });
});
