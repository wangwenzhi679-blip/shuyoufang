// 在保存 AI 题目之前校验作答所需的结构。
export function validGeneratedQuestions(questions) {
  return questions.every((question) => {
    const { type, options, answer } = question;
    if (type === '单选题' || type === '多选题') {
      if (
        options.length !== 4 ||
        options.some(
          (option, index) =>
            !new RegExp(`^${'ABCD'[index]}[.．、:：\\s]\\s*\\S`).test(option.trim()),
        )
      )
        return false;
      const texts = options.map((option) =>
        option
          .trim()
          .replace(/^[ABCD][.．、:：\s]\s*/, '')
          .trim(),
      );
      if (new Set(texts).size !== 4) return false;
      return type === '单选题' ? /^[ABCD]$/.test(answer) : /^(?=.{2,4}$)A?B?C?D?$/.test(answer);
    }
    if (type === '判断题')
      return (
        options.length === 2 &&
        options[0] === '正确' &&
        options[1] === '错误' &&
        ['正确', '错误'].includes(answer)
      );
    return ['填空题', '简答题'].includes(type) && options.length === 0;
  });
}
