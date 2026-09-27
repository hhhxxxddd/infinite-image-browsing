def make_page_cursor(date, media_id) -> str:
    """Build the cursor for the next page from the last row of this page.

    media.date is not unique (a bulk scan stamps hundreds of images with the
    same second), so the id is carried along as a tiebreaker.
    """
    return f"{date}|{media_id}"


def page_cursor_clause(cursor: str, params: list, table="media"):
    """WHERE fragment continuing after `cursor`, appending its params.

    Returns None when there is no cursor. Cursors written by older versions
    were a bare date; those still work, minus the tiebreaker.
    """
    if not cursor:
        return None
    date, separator, media_id = cursor.rpartition("|")
    if not separator:
        raise ValueError("Invalid media cursor")
    params.extend((date, date, int(media_id)))
    return f"({table}.date < ? OR ({table}.date = ? AND {table}.id < ?))"
