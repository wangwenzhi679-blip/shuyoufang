import React from 'react';

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code className="inline-code" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

export default function AssistantReading({ content }) {
  if (!content) return null;
  const blocks = [],
    lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].trim(),
      key = index;
    if (!text) {
      if (blocks.length && blocks.at(-1).type !== 'br')
        blocks.push(<br className="answer-gap" key={key} />);
      continue;
    }
    if (text.startsWith('```')) {
      const code = [];
      while (index + 1 < lines.length && !lines[index + 1].trim().startsWith('```'))
        code.push(lines[++index]);
      if (index + 1 < lines.length) index++;
      blocks.push(
        <pre key={key}>
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push(
        heading[1].length < 3 ? (
          <h3 className="answer-heading" key={key}>
            {inline(heading[2])}
          </h3>
        ) : (
          <h4 className="answer-subheading" key={key}>
            {inline(heading[2])}
          </h4>
        ),
      );
      continue;
    }
    const ordered = text.match(/^(\d+)[.、．)]\s+(.*)$/);
    if (ordered) {
      const title = ordered[2].match(/^\*\*([^*]+)\*\*\s*[：:]?\s*(.*)$/);
      blocks.push(
        <div className="answer-item" key={key}>
          <span className="answer-number">{ordered[1]}</span>
          <div className="answer-item-copy">
            {title ? (
              <>
                <strong className="answer-point-title">{title[1].replace(/[：:]$/, '')}</strong>
                {title[2] && <p>{inline(title[2])}</p>}
              </>
            ) : (
              <p>{inline(ordered[2])}</p>
            )}
          </div>
        </div>,
      );
      continue;
    }
    const bullet = text.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      blocks.push(
        <p className="answer-bullet" key={key}>
          <span className="bullet-dot" aria-hidden="true">
            •
          </span>
          <span>{inline(bullet[1])}</span>
        </p>,
      );
      continue;
    }
    if (
      text.startsWith('> ') ||
      /^(?:简单说|簡單說|一句话(?:理解|总结)?|一句話(?:理解|總結)?|小结|小結)[：:]/.test(text)
    ) {
      blocks.push(
        <blockquote className="scholar-takeaway" key={key}>
          {inline(text.replace(/^>\s*/, ''))}
        </blockquote>,
      );
      continue;
    }
    blocks.push(<p key={key}>{inline(text)}</p>);
  }
  return <div className="assistant-answer scholar-reading">{blocks}</div>;
}
