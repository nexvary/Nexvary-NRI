const reader = document.querySelector('[data-pdf-reader]');
const canvas = reader.querySelector('canvas');
const status = reader.querySelector('[role=status]');
const previous = reader.querySelector('[data-previous]');
const next = reader.querySelector('[data-next]');
const markPage = document.querySelector('input[name=page]');
const selectedVersion = document.querySelector('select[name=version]');
try {
  const { getDocument, GlobalWorkerOptions } = await import('/pdf-assets/pdf.mjs');
  GlobalWorkerOptions.workerSrc = '/pdf-assets/pdf.worker.mjs';
  const documentTask = getDocument({
    url: reader.dataset.pdfReader,
    isEvalSupported: false,
    enableXfa: false,
    useWasm: false,
    cMapUrl: '/pdf-assets/cmaps/',
    standardFontDataUrl: '/pdf-assets/standard_fonts/',
  });
  const pdf = await documentTask.promise;
  let pageNumber = Math.min(pdf.numPages, Number(reader.dataset.page));
  async function showPage() {
    next.disabled = previous.disabled = true;
    try {
      const page = await pdf.getPage(pageNumber);
      const original = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1400 / Math.max(original.width, original.height));
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      canvas.hidden = false;
      status.textContent = new Intl.NumberFormat(document.documentElement.lang).format(pageNumber) + ' / ' +
        new Intl.NumberFormat(document.documentElement.lang).format(pdf.numPages);
      if (selectedVersion.value === reader.dataset.version) markPage.value = pageNumber;
      const address = new URL(location.href);
      address.searchParams.set('page', pageNumber);
      history.replaceState(null, '', address);
      next.disabled = pageNumber === pdf.numPages;
      previous.disabled = pageNumber === 1;
    } catch {
      status.textContent = reader.dataset.error;
    }
  }
  previous.addEventListener('click', async () => { pageNumber--; await showPage(); });
  next.addEventListener('click', async () => { pageNumber++; await showPage(); });
  await showPage();
} catch {
  status.textContent = reader.dataset.error;
}
