import unittest

from fastapi import HTTPException

from omnigallery.workspaces.audio_streams import enumerate_audio_streams, selected_audio_stream


class AudioStreamTests(unittest.TestCase):
    def info(self, **extra):
        return {
            "format": {"duration": "20", "start_time": "5"},
            "streams": [
                {"index": 0, "codec_type": "video"},
                {
                    "index": 1,
                    "codec_type": "audio",
                    "start_time": "5",
                    "duration": "20",
                    "sample_rate": "48000",
                    "channels": 2,
                    "tags": {"language": "eng", "title": "English"},
                },
                {
                    "index": 3,
                    "codec_type": "audio",
                    "start_time": "8",
                    "duration": "12",
                    "sample_rate": "44100",
                    "channels": 1,
                    "disposition": {"default": 1},
                    **extra,
                },
            ],
        }

    def test_ordinal_is_audio_only_order_not_absolute_stream_index_or_default_disposition(self):
        streams = enumerate_audio_streams(self.info())
        self.assertEqual([(s["ordinal"], s["index"]) for s in streams], [(0, 1), (1, 3)])
        self.assertEqual(selected_audio_stream(self.info())["index"], 1)
        self.assertEqual(streams[0]["title"], "English")
        self.assertEqual(streams[0]["language"], "eng")
        self.assertTrue(streams[1]["default"])
        self.assertEqual((streams[1]["channels"], streams[1]["sample_rate"]), (1, 44100))

    def test_late_and_negative_starts_keep_container_relative_time_and_available_end(self):
        late = selected_audio_stream(self.info(), 1)
        self.assertEqual((late["start_time"], late["duration"], late["real_duration"]), (3, 15, 12))
        early = selected_audio_stream(self.info(start_time="3", duration="10"), 1)
        self.assertEqual((early["start_time"], early["duration"]), (-2, 8))
        capped = selected_audio_stream(self.info(duration="30"), 1)
        self.assertEqual(capped["duration"], 20)

    def test_missing_duration_uses_tags_or_container_end_without_changing_stream_origin(self):
        tagged = selected_audio_stream(
            self.info(duration="N/A", tags={"DURATION": "00:00:09.500"}), 1
        )
        self.assertEqual((tagged["duration"], tagged["real_duration"]), (12.5, 9.5))
        fallback = selected_audio_stream(self.info(duration="N/A"), 1)
        self.assertEqual((fallback["start_time"], fallback["duration"]), (3, 20))
        missing = self.info()
        del missing["streams"][1]["start_time"]
        self.assertEqual(selected_audio_stream(missing)["start_time"], 0)

    def test_invalid_missing_streams_and_unknown_duration_reject_without_falling_back(self):
        for value in (True, -1, 1.5, "1", 256, 2):
            with self.assertRaises(HTTPException):
                selected_audio_stream(self.info(), value)
        with self.assertRaises(HTTPException):
            selected_audio_stream({"streams": []})
        with self.assertRaises(HTTPException):
            selected_audio_stream({"streams": [{"codec_type": "audio", "duration": "N/A"}]})

    def test_matroska_duration_tag_is_an_absolute_endpoint_not_a_length(self):
        info = self.info(duration="N/A", tags={"DURATION": "00:00:10.000"})
        info["format"]["format_name"] = "matroska,webm"
        stream = selected_audio_stream(info, 1)
        self.assertEqual(
            (stream["start_time"], stream["duration"], stream["real_duration"]), (3, 5, 2)
        )

    def test_invalid_duration_tag_does_not_invent_a_partial_numeric_duration(self):
        info = {"streams": [{"codec_type": "audio", "tags": {"DURATION": "bad:bad:12"}}]}
        with self.assertRaises(HTTPException):
            selected_audio_stream(info)


if __name__ == "__main__":
    unittest.main()
