$source = 'C:\Users\LUBS\Documents\Boat\Spensa\Schoolpay Students_files\sheet001.htm'
$output = 'C:\Projects\BOAT\schoolpay-students-extracted.csv'

$headers = @(
  'payment_code', 'suite_code', 'first_name', 'last_name', 'class_code',
  'student_email', 'student_phone', 'source_first_name', 'source_last_name',
  'source_value_3', 'class', 'stream', 'day_boarding', 'gender'
)

$html = Get-Content -LiteralPath $source -Raw
$records = foreach ($row in [regex]::Matches($html, '(?is)<tr\b[^>]*>(.*?)</tr>')) {
  $cells = @(
    [regex]::Matches($row.Groups[1].Value, '(?is)<td\b[^>]*>(.*?)</td>') | ForEach-Object {
      $value = [regex]::Replace($_.Groups[1].Value, '(?is)<[^>]+>', '')
      [System.Net.WebUtility]::HtmlDecode($value).Replace([char]0xA0, ' ').Trim()
    }
  )

  if ($cells.Count -ge 7 -and $cells[0] -match '^\d{8,}$') {
    $record = [ordered]@{}
    for ($index = 0; $index -lt $headers.Count; $index++) {
      $value = if ($index -lt $cells.Count) { $cells[$index] } else { '' }
      $record[$headers[$index]] = if ($value -match '^\(not set\)') { '' } else { $value }
    }
    [pscustomobject]$record
  }
}

$records | Export-Csv -LiteralPath $output -NoTypeInformation -Encoding utf8
Write-Output "Extracted $($records.Count) records to $output"
