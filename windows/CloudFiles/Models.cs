using System.Text.Json.Serialization;

namespace Tern.Windows;

public sealed record Manifest
{
    [JsonPropertyName("schema_version")]
    public int SchemaVersion { get; init; }

    [JsonPropertyName("generated_at")]
    public DateTimeOffset GeneratedAt { get; init; }

    [JsonPropertyName("entries")]
    public IReadOnlyList<ManifestEntry> Entries { get; init; } = [];
}

public sealed record ManifestEntry
{
    [JsonPropertyName("relative_path")]
    public required string RelativePath { get; init; }

    [JsonPropertyName("kind")]
    public required string Kind { get; init; }

    [JsonPropertyName("course_id")]
    public required string CourseId { get; init; }

    [JsonPropertyName("source_id")]
    public required string SourceId { get; init; }

    [JsonPropertyName("revision")]
    public required string Revision { get; init; }

    [JsonPropertyName("size")]
    public long Size { get; init; }

    [JsonPropertyName("updated_at")]
    public string? UpdatedAt { get; init; }

    [JsonPropertyName("content_type")]
    public string? ContentType { get; init; }

    [JsonIgnore]
    public string SourceKey => $"{Kind}\u001f{CourseId}\u001f{SourceId}";

    public PlaceholderIdentity Identity => new(1, Kind, CourseId, SourceId, Revision);
}

public sealed record PlaceholderIdentity(
    [property: JsonPropertyName("v")] int Version,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("course_id")] string CourseId,
    [property: JsonPropertyName("source_id")] string SourceId,
    [property: JsonPropertyName("revision")] string Revision)
{
    [JsonIgnore]
    public string SourceKey => $"{Kind}\u001f{CourseId}\u001f{SourceId}";
    [JsonIgnore]
    public string ExactKey => $"{SourceKey}\u001f{Revision}";
}

public sealed record LocalEntry(
    string RelativePath,
    bool IsManaged,
    PlaceholderIdentity? Identity,
    bool IsInSync,
    bool IsHydrated,
    bool IsPinned)
{
    public string? SourceKey => Identity?.SourceKey;
    public string? ExactKey => Identity?.ExactKey;
}

public sealed record ReconcileSummary(
    int Created,
    int Updated,
    int Removed,
    int Conflicts,
    int Unchanged);

