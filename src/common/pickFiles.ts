/** 弹出「选文件」对话框，返回选中的文件；取消返回空数组。 */
export function pickFiles(accept = "image/png,image/jpeg,image/webp"): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = true;
    input.addEventListener("change", () => resolve(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
