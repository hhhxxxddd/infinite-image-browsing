import argparse
import os
import random
from contextlib import closing
from datetime import datetime

from omnigallery.infrastructure.database import Database


def get_creation_time_path(file_path: str) -> str:
    """
    Get the creation time of a file and format it as YYYYMMDD_HHMMSS_<random>.
    Format example: 20260123_011706_8662450

    On Windows, this uses creation time. On Unix, falls back to modification time.

    Args:
        file_path (str): Path to the file.

    Returns:
        str: Formatted creation time string (YYYYMMDD_HHMMSS_<random>).
    """
    # On Windows, st_ctime is creation time
    # On Unix, st_ctime is metadata change time, so we use st_mtime
    if os.name == "nt":
        timestamp = os.path.getctime(file_path)
    else:
        timestamp = os.path.getmtime(file_path)

    dt = datetime.fromtimestamp(timestamp)
    time_str = dt.strftime("%Y%m%d_%H%M%S")
    random_fragment = random.randint(1000000, 9999999)
    return f"{time_str}_{random_fragment}"


def check_database_exists(conn, file_path: str) -> bool:
    """
    Check if a file path exists in the database.

    Args:
        conn: Database connection object.
        file_path (str): Path to check.

    Returns:
        bool: True if the file path exists in the database.
    """
    normalized_path = os.path.normpath(file_path)

    with closing(conn.cursor()) as cur:
        cur.execute("SELECT 1 FROM media WHERE path = ? LIMIT 1", (normalized_path,))
        return cur.fetchone() is not None


def update_database_paths(conn, old_path: str, new_path: str):
    """
    Update database paths when a file is renamed.

    Args:
        conn: Database connection object.
        old_path (str): Original file path.
        new_path (str): New file path after rename.
    """
    normalized_old = os.path.normpath(old_path)
    normalized_new = os.path.normpath(new_path)

    with closing(conn.cursor()) as cur:
        # Update media table
        cur.execute("UPDATE media SET path = ? WHERE path = ?", (normalized_new, normalized_old))


def normalize_single_file(file_path: str, dry_run: bool, conn):
    """
    Normalize a single file's name based on its creation time (YYYYMMDD_HHMMSS_<random>).

    Args:
        file_path (str): Path to the file to normalize.
        dry_run (bool): If True, only print without renaming.
        conn: Database connection object. If provided, will update database paths.

    Returns:
        tuple: (status, message) where status is 'normalized', 'skipped', or 'error'
    """
    try:
        # Get the directory and file extension
        dir_path = os.path.dirname(file_path)
        filename = os.path.basename(file_path)
        name, ext = os.path.splitext(filename)

        # Skip if already in the target format (YYYYMMDD_HHMMSS_<random>)
        # Format: 8 digits + _ + 6 digits + _ + 7 digits = 23 characters
        parts = name.split("_")
        if (
            len(parts) == 3
            and len(parts[0]) == 8
            and parts[0].isdigit()
            and len(parts[1]) == 6
            and parts[1].isdigit()
            and len(parts[2]) == 7
            and parts[2].isdigit()
        ):
            return "skipped", f"Skip (already normalized): {filename}"

        # Get creation time formatted string
        time_str = get_creation_time_path(file_path)
        new_filename = f"{time_str}{ext}"
        new_path = os.path.join(dir_path, new_filename)

        # Handle duplicate filenames by appending a counter
        counter = 1
        while os.path.exists(new_path) and new_path != file_path:
            new_filename = f"{time_str}_{counter}{ext}"
            new_path = os.path.join(dir_path, new_filename)
            counter += 1

        if new_path == file_path:
            return "skipped", f"Skip (same name): {filename}"

        if dry_run:
            # Check if file exists in database and include in message
            db_info = ""
            if conn:
                if check_database_exists(conn, file_path):
                    db_info = " [in database]"
                else:
                    db_info = " [not in database]"
            return "normalized", f"Would normalize: {filename} -> {new_filename}{db_info}"
        else:
            os.rename(file_path, new_path)
            # Update database if connection is provided
            if conn:
                update_database_paths(conn, file_path, new_path)
            return "normalized", f"Normalized: {filename} -> {new_filename}"

    except Exception as e:
        return "error", f"Error normalizing {file_path}: {e}"


def normalize_filenames(
    dir_path: str, recursive: bool = False, dry_run: bool = False, db_path: str = None
):
    """
    Normalize all filenames in the specified directory to creation time format (YYYYMMDD_HHMMSS_<random>).

    Args:
        dir_path (str): Path to the directory containing files to normalize.
        recursive (bool): Whether to recursively process subdirectories. Default is False.
        dry_run (bool): If True, only print what would be normalized without actually renaming. Default is False.
        db_path (str): Path to the OmniGallery database file to update with new paths. Default is None.
    """
    normalized_count = 0
    skipped_count = 0
    error_count = 0

    # Setup database connection if db_path is provided
    conn = None
    if db_path:
        Database.path = os.path.normpath(os.path.join(os.getcwd(), db_path))
        conn = Database.get_connection()

    files_to_process = []

    if recursive:
        # Walk through all files in directory and subdirectories
        for root, _, files in os.walk(dir_path):
            for filename in files:
                files_to_process.append(os.path.join(root, filename))
    else:
        # Only process files in the specified directory (non-recursive)
        for entry in os.listdir(dir_path):
            full_path = os.path.join(dir_path, entry)
            if os.path.isfile(full_path):
                files_to_process.append(full_path)

    # Process all files
    for file_path in files_to_process:
        status, message = normalize_single_file(file_path, dry_run, conn)
        print(message)
        if status == "normalized":
            normalized_count += 1
        elif status == "skipped":
            skipped_count += 1
        elif status == "error":
            error_count += 1

    print(
        f"\nSummary: {'Dry run - ' if dry_run else ''}Normalized: {normalized_count}, Skipped: {skipped_count}, Errors: {error_count}"
    )

    if conn and not dry_run:
        conn.commit()
        print(f"Database updated at: {db_path}")


def setup_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normalize filenames to creation time format (YYYYMMDD_HHMMSS_<random>) and optionally update OmniGallery database paths."
    )
    parser.add_argument(
        "dir_path", type=str, help="Path to the directory containing files to normalize."
    )
    parser.add_argument(
        "-r", "--recursive", action="store_true", help="Recursively process subdirectories."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Actually perform the normalization. Without this flag, runs in dry-run mode.",
    )
    parser.add_argument(
        "--db_path",
        type=str,
        help="Path to the OmniGallery database file to update with new paths. Uses the configured application database by default.",
        default="omnigallery.db",
    )
    return parser


if __name__ == "__main__":
    parser = setup_parser()
    args = parser.parse_args()

    # Default to dry-run mode unless --force is specified
    dry_run = not args.force
    normalize_filenames(args.dir_path, args.recursive, dry_run, args.db_path)
