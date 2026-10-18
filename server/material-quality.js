// 替换字符、私用字形，以及公式附近的占位方框表示文字提取不完整。
// 普通项目符号和待填写的方框不应触发此判断。
export function hasDamagedFormula(text) {
  const value = String(text || '');
  if (/[\ufffd\ue000-\uf8ff]/u.test(value)) return true;
  return value.split(/\r?\n/).some((line) => {
    if (!/[\u25a0-\u25a3]/u.test(line)) return false;
    if (/^\s*[\u25a0-\u25a3]\s+[^\u25a0-\u25a3]*$/u.test(line) && !/[=+−×÷]/u.test(line))
      return false;
    return /[0-9=+−×÷]/u.test(line) || (line.match(/[\u25a0-\u25a3]/gu) || []).length > 1;
  });
}

export function assertReadableContext(text) {
  if (hasDamagedFormula(text)) {
    throw Object.assign(
      new Error(
        '本章资料有未识别的公式或符号。请先查看原资料，并补充可识别的文字或公式后再生成；原文件仍可正常阅读。',
      ),
      { status: 422 },
    );
  }
}
