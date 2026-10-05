/** Synthetic releases exercise table units and period selection without network access. */
export function himsFixtureHtml(year = 2026, reverseYears = false) {
  const cells = (label: string, current: string, before: string) => `<tr><td>${label}</td><td>${reverseYears ? before : current}</td><td>${reverseYears ? current : before}</td><td>20%</td><td>999999</td><td>999999</td></tr>`
  return `<p>Hims &amp; Hers announced financial results for the second quarter ended June 30, ${year}.</p>
  <table><tr><td>Six Months Ended June 30,</td></tr><tr><td></td><td>${year}</td><td>${year - 1}</td></tr>${cells('Revenue', '999999', '999999')}</table>
  <table><tr><td>Three Months Ended June 30,</td><td>Six Months Ended June 30,</td></tr><tr><td></td><td>${reverseYears ? year - 1 : year}</td><td>${reverseYears ? year : year - 1}</td></tr>
    ${cells('Revenue', '750,000', '500,000')}${cells('Subscribers (end of period)', '2,900', '2,400')}
    ${cells(year >= 2026 ? 'Monthly Revenue per Average Subscriber' : 'Monthly Online Revenue per Average Subscriber', '92', '76')}
    ${cells('Gross profit', '480,000', '400,000')}${cells('Marketing', '260,000', '210,000')}
    ${cells('(Loss) income from operations', '(90,000)', '25,000')}${cells('Net (loss) income', '(80,000)', '40,000')}
    ${cells('Diluted', '(0.37)', '0.17')}${cells('Adjusted EBITDA', '60,000', '80,000')}
    ${cells('Net cash (used in) provided by operating activities', '(35,000)', '(19,000)')}${cells('Free Cash Flow', '(68,000)', '(69,000)')}
    ${cells(year >= 2026 ? 'United States Revenue' : 'Online Revenue', '620,000', '490,000')}${cells(year >= 2026 ? 'Rest of the World Revenue' : 'Wholesale Revenue', '130,000', '10,000')}
  </table><p>Financial Outlook</p><p>For the third quarter ${year}, we expect: Revenue of $880 million to $900 million. Adjusted EBITDA of $75 million to $95 million.</p>
  <p>For the full year ${year}, we expect: Revenue of $3.1 billion to $3.3 billion. Adjusted EBITDA of $275 million to $325 million.</p><p>Conference Call</p>`
}
