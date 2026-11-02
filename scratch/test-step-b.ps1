$body = @{
    article_ids = @(
        "b979a75d-676b-40f2-9ad0-cb9e7ddd59dc",
        "b4cde95b-0c70-4f2f-8017-b191bbdccb26"
    )
} | ConvertTo-Json -Depth 5

$response = Invoke-RestMethod `
    -Uri "http://127.0.0.1:8787/api/ai/extract-topic-articles" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

Write-Host "=== Step B Live Verification Response ==="
Write-Host "Success:" $response.success
Write-Host "Provider:" $response.provider
Write-Host "Requested Article Count:" $response.requested_article_count
Write-Host "Successful Extraction Count:" $response.successful_extraction_count
Write-Host "Failed Extraction Count:" $response.failed_extraction_count
Write-Host "Unique Source Domain Count:" $response.source_metrics.unique_source_domain_count
Write-Host "Source Diversity Status:" $response.source_metrics.source_diversity_status

foreach ($art in $response.articles) {
    Write-Host "--------------------------------------------------"
    Write-Host "Article ID:" $art.article_id
    Write-Host "Success:" $art.success
    Write-Host "Original Title:" $art.original_title
    Write-Host "Original URL:" $art.original_url
    Write-Host "Extracted Title:" $art.extracted_title
    Write-Host "Content Length:" $art.content_length
    Write-Host "Paragraph Count:" $art.paragraph_count
    Write-Host "Beginning Excerpt:"
    Write-Host $art.content.Substring(0, [Math]::Min(300, $art.content.Length))
    Write-Host "..."
    Write-Host "Ending Excerpt:"
    Write-Host $art.content.Substring([Math]::Max(0, $art.content.Length - 300))
}
