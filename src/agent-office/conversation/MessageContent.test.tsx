import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent, isJson, safeHref } from './MessageContent.js';

describe('MessageContent',()=>{
  it('renders structured markdown without injecting raw html',()=>{
    const html=renderToStaticMarkup(<MessageContent content={'## Estrutura\n\n- **Banco:** SQLite\n- Porta: `3000`\n\n> pronto'}/>);
    expect(html).toContain('<h3>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Banco:</strong>');
    expect(html).toContain('<code>3000</code>');
    expect(html).toContain('<blockquote>');
  });

  it('renders fenced code and tables',()=>{
    const content='\`\`\`ts\nconst ok = true\n\`\`\`\n\n| Item | Status |\n| --- | --- |\n| Build | PASS |';
    const html=renderToStaticMarkup(<MessageContent content={content}/>);
    expect(html).toContain('const ok = true');
    expect(html).toContain('<table>');
    expect(html).toContain('Copiar');
  });

  it('keeps unsafe links non-clickable and raw html escaped',()=>{
    const html=renderToStaticMarkup(<MessageContent content={'[ruim](javascript:alert(1)) <script>alert(2)</script>'}/>);
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('&lt;script&gt;');
  });

  it('recognizes JSON and only allows safe link protocols',()=>{
    expect(isJson('{"ok":true}')).toBe(true);
    expect(isJson('not json')).toBe(false);
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(safeHref('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
  });
});
