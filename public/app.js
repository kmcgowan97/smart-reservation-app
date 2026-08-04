const dateInput = document.querySelector('input[name="date"]');
dateInput.min = new Date().toISOString().slice(0, 10);
dateInput.value = dateInput.min;

document.querySelector('#reservation-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#reservation-status');
  const button = form.querySelector('button');
  const data = Object.fromEntries(new FormData(form));
  data.party_size = Number(data.party_size);
  button.disabled = true;
  status.textContent = 'Saving your reservation…';
  try {
    const response = await fetch('/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.errors?.join(' ') || 'Unable to save reservation.');
    status.textContent = `You're all set — confirmation #${result.id}.`;
    form.reset(); dateInput.value = dateInput.min;
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});

document.querySelector('#ai-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#ai-question');
  const answer = document.querySelector('#ai-answer');
  const button = event.currentTarget.querySelector('button');
  button.disabled = true; answer.textContent = 'Checking the books…';
  try {
    const response = await fetch('/ai/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: input.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'The assistant is unavailable right now.');
    answer.textContent = result.answer;
  } catch (error) { answer.textContent = error.message; }
  finally { button.disabled = false; }
});
