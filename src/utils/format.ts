// 格式化积分/数量显示
// 小于5位数，显示数值
// 5位数-8位数显示万
// 9位-12位显示亿
// 13位以上显示万亿
export function formatPoints(value: number): string;
export function formatPoints(value: number, returnObject: true): { value: string; unit: string };
export function formatPoints(
  value: number,
  returnObject = false,
): string | { value: string; unit: string } {
  value = Math.abs(value);
  let val: string;
  let unit = '';

  if (value < 10000) {
    val = value.toString();
  } else if (value < 100000000) {
    val = parseFloat((value / 10000).toFixed(1)).toString();
    unit = '万';
  } else if (value < 1000000000000) {
    val = parseFloat((value / 100000000).toFixed(1)).toString();
    unit = '亿';
  } else {
    val = parseFloat((value / 1000000000000).toFixed(1)).toString();
    unit = '万亿';
  }

  if (returnObject) {
    return { value: val, unit };
  }

  return val + unit;
}

// 格式化数字为千位分隔符格式
// 例如: 42534334456 -> "42,534,334,456"
export function formatNumberWithCommas(value: number | string): string {
  const absValue = typeof value === 'string' ? Math.abs(parseFloat(value)) : Math.abs(value);
  const num = absValue.toString();
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
