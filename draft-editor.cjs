#!/usr/bin/env node
/**
 * Simple draft editor server
 * Run: node draft-editor.cjs --edit
 * Opens at: http://localhost:4322/draft/[filename]
 *
 * Example: http://localhost:4322/draft/vllm-vs-tensorrt-llm-architecture-v2
 */

// Require --edit flag to run
if (!process.argv.includes('--edit')) {
  console.log('\n  Draft Editor\n');
  console.log('  Usage: node draft-editor.cjs --edit\n');
  process.exit(1);
}

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 4322;
const BLOG_DIR = path.join(__dirname, 'src/pages/blog');

// Parse frontmatter from markdown
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (match) {
    const frontmatter = {};
    match[1].split('\n').forEach(line => {
      const [key, ...rest] = line.split(':');
      if (key && rest.length) {
        frontmatter[key.trim()] = rest.join(':').trim().replace(/^['"]|['"]$/g, '');
      }
    });
    return { frontmatter, body: match[2] };
  }
  return { frontmatter: {}, body: content };
}

// Rebuild frontmatter string
function buildFrontmatter(fm) {
  let str = '---\n';
  str += `layout: '../../layouts/PostLayout.astro'\n`;
  str += `title: '${fm.title || ''}'\n`;
  str += `description: "${fm.description || ''}"\n`;
  str += `pubDate: '${fm.pubDate || new Date().toISOString().split('T')[0]}'\n`;
  str += `tags: ${fm.tags || "['machine learning']"}\n`;
  str += '---\n\n';
  return str;
}

const editorHTML = (slug, frontmatter, body) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Draft: ${frontmatter.title || slug}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a1a;
      color: #e0e0e0;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .header {
      padding: 12px 20px;
      background: #252525;
      border-bottom: 1px solid #333;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .header h1 { font-size: 16px; font-weight: 500; flex: 1; }
    .header input {
      background: #333;
      border: 1px solid #444;
      color: #e0e0e0;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 14px;
    }
    .header input.title { width: 300px; }
    .header input.desc { width: 400px; }
    .btn {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 500;
    }
    .btn-save { background: #22c55e; color: white; }
    .btn-save:hover { background: #16a34a; }
    .btn-preview { background: #3b82f6; color: white; }
    .btn-preview:hover { background: #2563eb; }
    .status { font-size: 12px; color: #888; }
    .container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .editor-pane, .preview-pane {
      flex: 1;
      overflow: auto;
      padding: 20px;
    }
    .editor-pane {
      border-right: 1px solid #333;
    }
    textarea {
      width: 100%;
      height: 100%;
      background: #1a1a1a;
      color: #e0e0e0;
      border: none;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 14px;
      line-height: 1.6;
      resize: none;
      outline: none;
    }
    .preview-pane {
      background: #fff;
      color: #1a1a1a;
    }
    .preview-pane h1 { font-size: 2em; margin: 0.5em 0; }
    .preview-pane h2 { font-size: 1.5em; margin: 1em 0 0.5em; border-bottom: 1px solid #eee; padding-bottom: 0.3em; }
    .preview-pane h3 { font-size: 1.25em; margin: 1em 0 0.5em; }
    .preview-pane p { margin: 1em 0; line-height: 1.7; }
    .preview-pane ul, .preview-pane ol { margin: 1em 0; padding-left: 2em; }
    .preview-pane li { margin: 0.5em 0; }
    .preview-pane code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
    .preview-pane pre { background: #1a1a1a; color: #e0e0e0; padding: 16px; border-radius: 6px; overflow-x: auto; }
    .preview-pane pre code { background: none; padding: 0; }
    .preview-pane table { border-collapse: collapse; width: 100%; margin: 1em 0; }
    .preview-pane th, .preview-pane td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
    .preview-pane th { background: #f4f4f4; }
    .preview-pane strong { font-weight: 600; }
    .preview-pane blockquote { border-left: 4px solid #ddd; padding-left: 1em; margin: 1em 0; color: #666; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Draft Editor</h1>
    <input type="text" class="title" id="title" placeholder="Title" value="${(frontmatter.title || '').replace(/"/g, '&quot;')}">
    <input type="text" class="desc" id="description" placeholder="Description" value="${(frontmatter.description || '').replace(/"/g, '&quot;')}">
    <button class="btn btn-save" onclick="save()">Save</button>
    <a href="http://localhost:4321/blog/${slug}" target="_blank" class="btn btn-preview">View Live</a>
    <span class="status" id="status"></span>
  </div>
  <div class="container">
    <div class="editor-pane">
      <textarea id="editor" spellcheck="false">${body.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
    </div>
    <div class="preview-pane" id="preview"></div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    const slug = '${slug}';
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    const status = document.getElementById('status');

    function updatePreview() {
      preview.innerHTML = marked.parse(editor.value);
    }

    editor.addEventListener('input', updatePreview);
    updatePreview();

    async function save() {
      status.textContent = 'Saving...';
      try {
        const res = await fetch('/save/' + slug, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('title').value,
            description: document.getElementById('description').value,
            body: editor.value
          })
        });
        if (res.ok) {
          status.textContent = 'Saved!';
          setTimeout(() => status.textContent = '', 2000);
        } else {
          status.textContent = 'Error saving';
        }
      } catch (e) {
        status.textContent = 'Error: ' + e.message;
      }
    }

    // Ctrl+S to save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    });
  </script>
</body>
</html>
`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Serve editor
  if (url.pathname.startsWith('/draft/')) {
    const slug = url.pathname.replace('/draft/', '');
    const filePath = path.join(BLOG_DIR, `${slug}.md`);

    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end(`File not found: ${slug}.md`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(editorHTML(slug, frontmatter, body));
    return;
  }

  // Save endpoint
  if (url.pathname.startsWith('/save/') && req.method === 'POST') {
    const slug = url.pathname.replace('/save/', '');
    const filePath = path.join(BLOG_DIR, `${slug}.md`);

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter } = parseFrontmatter(content);

        // Update frontmatter with new title/description
        frontmatter.title = data.title;
        frontmatter.description = data.description;

        const newContent = buildFrontmatter(frontmatter) + data.body;
        fs.writeFileSync(filePath, newContent);

        res.writeHead(200);
        res.end('OK');
      } catch (e) {
        res.writeHead(500);
        res.end(e.message);
      }
    });
    return;
  }

  // List drafts
  if (url.pathname === '/') {
    const files = fs.readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));
    const list = files.map(f => {
      const slug = f.replace('.md', '');
      return `<li><a href="/draft/${slug}">${slug}</a></li>`;
    }).join('\n');

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><title>Draft Editor</title>
      <style>
        body { font-family: system-ui; background: #1a1a1a; color: #e0e0e0; padding: 40px; }
        a { color: #3b82f6; }
        li { margin: 8px 0; }
      </style>
      </head>
      <body>
        <h1>Blog Drafts</h1>
        <ul>${list}</ul>
      </body>
      </html>
    `);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  Draft Editor running at:`);
  console.log(`  → http://localhost:${PORT}/`);
  console.log(`  → http://localhost:${PORT}/draft/vllm-vs-tensorrt-llm-architecture-v2\n`);
});
