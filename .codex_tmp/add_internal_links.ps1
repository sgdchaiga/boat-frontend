param([Parameter(Mandatory=$true)][string]$WorkbookPath)
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$nav = @(
  @{Row=4; Target='Menu'}, @{Row=6; Target='Cashbook Entry'}, @{Row=7; Target='Cashbook Register'}, @{Row=8; Target='Daily Cashbook'},
  @{Row=10; Target='Dashboard'}, @{Row=12; Target='Borrowers'}, @{Row=13; Target='Loan Products'}, @{Row=15; Target='Applications'},
  @{Row=16; Target='Approvals & Disb.'}, @{Row=17; Target='Collections'}, @{Row=19; Target='Follow-ups'}, @{Row=20; Target='Loan Servicing'},
  @{Row=21; Target='Portfolio Risk'}, @{Row=22; Target='Provisioning'}, @{Row=23; Target='Restructures'}, @{Row=24; Target='Write-offs'},
  @{Row=26; Target='Reports'}, @{Row=27; Target='Integration'}
)
$extra = @{
  1 = @(@{Ref='D13:H15';Target='Cashbook Entry';Label='Cashbook Entry'},@{Ref='J13:N15';Target='Dashboard';Label='Dashboard'},@{Ref='P13:S15';Target='Reports';Label='Reports'})
  18 = @(@{Ref='G7';Target='Borrowers';Label='OPEN'},@{Ref='G8';Target='Portfolio Risk';Label='OPEN'},@{Ref='G9';Target='Collections';Label='OPEN'},@{Ref='G10';Target='Cashbook Register';Label='OPEN'})
}
$zip=[System.IO.Compression.ZipFile]::Open($WorkbookPath,[System.IO.Compression.ZipArchiveMode]::Update)
try {
  for($sheet=1;$sheet -le 18;$sheet++) {
    $name="xl/worksheets/sheet$sheet.xml"
    $entry=$zip.GetEntry($name)
    $reader=[System.IO.StreamReader]::new($entry.Open())
    $xml=$reader.ReadToEnd(); $reader.Dispose()
    $items=New-Object System.Collections.Generic.List[string]
    foreach($n in $nav) {
      $target=[System.Security.SecurityElement]::Escape("'$($n.Target)'!A1")
      $label=[System.Security.SecurityElement]::Escape($n.Target)
      $items.Add("<x:hyperlink ref=`"A$($n.Row):C$($n.Row)`" location=`"$target`" display=`"$label`" tooltip=`"Open $label`"/>")
    }
    if($extra.ContainsKey($sheet)) { foreach($x in $extra[$sheet]) { $target=[System.Security.SecurityElement]::Escape("'$($x.Target)'!A1");$label=[System.Security.SecurityElement]::Escape($x.Label);$items.Add("<x:hyperlink ref=`"$($x.Ref)`" location=`"$target`" display=`"$label`" tooltip=`"Open $label`"/>") } }
    $block='<x:hyperlinks>'+($items -join '')+'</x:hyperlinks>'
    if($xml -match '<x:hyperlinks>.*?</x:hyperlinks>') {$xml=[regex]::Replace($xml,'<x:hyperlinks>.*?</x:hyperlinks>',$block)}
    elseif($xml.Contains('<x:pageMargins')) {$xml=$xml.Replace('<x:pageMargins',$block+'<x:pageMargins')}
    elseif($xml.Contains('<x:tableParts')) {$xml=$xml.Replace('<x:tableParts',$block+'<x:tableParts')}
    else {$xml=$xml.Replace('</x:worksheet>',$block+'</x:worksheet>')}
    $entry.Delete(); $new=$zip.CreateEntry($name,[System.IO.Compression.CompressionLevel]::Optimal)
    $writer=[System.IO.StreamWriter]::new($new.Open(),[System.Text.UTF8Encoding]::new($false));$writer.Write($xml);$writer.Dispose()
  }
} finally {$zip.Dispose()}
