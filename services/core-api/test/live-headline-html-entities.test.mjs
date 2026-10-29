import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanLiveText } from '../dist/live/live.adapter.js';

test('live RSS adapter decodes source title quote, ampersand and dash entities', () => {
  assert.equal(
    cleanLiveText(
      'Natalia Valdebenito: &amp;#34;El sueldo debiera ser más alto&amp;#34; &amp; '
        + '&quot;otra cita&quot; &#39;nota&#39; &#8220;comillas&#8221; &ndash; Viña',
    ),
    'Natalia Valdebenito: "El sueldo debiera ser más alto" & "otra cita" '
      + "'nota' “comillas” – Viña",
  );
});
